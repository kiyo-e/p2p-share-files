// Design: see README.md for the signaling flow; related to src/client/room.tsx.

use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use clap::{Parser, Subcommand};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use url::Url;
use uuid::Uuid;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_init::RTCDataChannelInit;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

#[derive(Parser, Debug)]
#[command(name = "share-files-cli")]
#[command(about = "P2P file transfer CLI for share-files")]
struct Cli {
  #[command(subcommand)]
  command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
  Send {
    #[arg(long)]
    room_id: Option<String>,
    #[arg(long)]
    file: PathBuf,
    #[arg(long)]
    endpoint: Option<String>,
  },
  Receive {
    #[arg(long)]
    room_id: String,
    #[arg(long, default_value = ".")]
    output_dir: PathBuf,
    #[arg(long)]
    endpoint: Option<String>,
  },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ServerMessage {
  #[serde(rename = "role")]
  Role { role: String, cid: String },
  #[serde(rename = "peers")]
  Peers { count: u32 },
  #[serde(rename = "wait")]
  Wait { position: Option<u32> },
  #[serde(rename = "start")]
  Start { #[serde(rename = "peerId")] peer_id: Option<String> },
  #[serde(rename = "peer-left")]
  PeerLeft { #[serde(rename = "peerId")] peer_id: String },
  #[serde(rename = "offer")]
  Offer { from: String, sid: u64, sdp: RTCSessionDescription },
  #[serde(rename = "answer")]
  Answer { from: String, sid: u64, sdp: RTCSessionDescription },
  #[serde(rename = "candidate")]
  Candidate { from: String, sid: u64, candidate: RTCIceCandidateInit },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum ClientMessage {
  #[serde(rename = "offer")]
  Offer { to: String, sid: u64, sdp: RTCSessionDescription },
  #[serde(rename = "answer")]
  Answer { to: String, sid: u64, sdp: RTCSessionDescription },
  #[serde(rename = "candidate")]
  Candidate { to: String, sid: u64, candidate: RTCIceCandidateInit },
  #[serde(rename = "transfer-done")]
  TransferDone { #[serde(rename = "peerId")] peer_id: String },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum DataMessage {
  #[serde(rename = "meta")]
  Meta {
    name: String,
    size: u64,
    mime: String,
    encrypted: bool,
  },
  #[serde(rename = "done")]
  Done,
}

#[derive(Clone)]
struct FileInfo {
  path: PathBuf,
  name: String,
  size: u64,
  mime: String,
}

struct OffererPeerState {
  signal_sid: u64,
  active_sid: Option<u64>,
  pending_candidates: Vec<PendingCandidate>,
  remote_desc_set: bool,
  sending: bool,
}

struct PendingCandidate {
  sid: u64,
  candidate: RTCIceCandidateInit,
}

struct OffererPeer {
  peer_id: String,
  pc: Arc<RTCPeerConnection>,
  state: Arc<Mutex<OffererPeerState>>,
}

struct ReceiverState {
  pc: Arc<RTCPeerConnection>,
  peer_id: Option<String>,
  active_sid: Option<u64>,
  pending_candidates: Vec<PendingCandidate>,
  remote_desc_set: bool,
}

struct ReceiveProgress {
  output_dir: PathBuf,
  current_file: Option<PathBuf>,
  file: Option<File>,
  expected_size: u64,
  received: u64,
}

#[tokio::main]
async fn main() -> Result<()> {
  let cli = Cli::parse();

  match cli.command {
    Command::Send { room_id, file, endpoint } => run_send(room_id.as_deref(), &file, endpoint.as_deref()).await,
    Command::Receive { room_id, output_dir, endpoint } => run_receive(&room_id, &output_dir, endpoint.as_deref()).await,
  }
}

async fn run_send(room_id: Option<&str>, file_path: &Path, endpoint: Option<&str>) -> Result<()> {
  let file_info = load_file_info(file_path).await?;
  let room_id = match room_id {
    Some(value) => value.to_string(),
    None => create_room(endpoint).await?,
  };
  let client_id = Uuid::new_v4().to_string();
  let ws_url = build_ws_url(endpoint, &room_id, &client_id)?;

  log_line("[room] id", &room_id);
  log_line("[room] url", &build_room_url(endpoint, &room_id)?);
  log_line("[ws] connecting", &ws_url.to_string());
  let (ws_stream, _) = connect_async(ws_url.to_string())
    .await
    .context("connect signaling websocket")?;
  let (mut ws_write, mut ws_read) = ws_stream.split();

  let (signal_tx, mut signal_rx) = mpsc::unbounded_channel::<ClientMessage>();

  let writer = tokio::spawn(async move {
    while let Some(msg) = signal_rx.recv().await {
      let text = serde_json::to_string(&msg).map_err(|err| anyhow!(err))?;
      ws_write.send(Message::Text(text)).await.map_err(|err| anyhow!(err))?;
    }
    Ok::<(), anyhow::Error>(())
  });

  let peers: Arc<Mutex<HashMap<String, Arc<OffererPeer>>>> = Arc::new(Mutex::new(HashMap::new()));
  let file_info = Arc::new(file_info);

  while let Some(msg) = ws_read.next().await {
    let msg = msg.context("websocket read")?;
    if let Message::Text(text) = msg {
      let parsed: ServerMessage = match serde_json::from_str(&text) {
        Ok(msg) => msg,
        Err(_) => continue,
      };

      match parsed {
        ServerMessage::Role { role, cid } => {
          log_line("[ws] role", &format!("{role} ({cid})"));
          if role != "offerer" {
            return Err(anyhow!("This command must be the offerer; connect first or use receive."));
          }
        }
        ServerMessage::Peers { count } => {
          log_line("[ws] peers", &count.to_string());
        }
        ServerMessage::Wait { position } => {
          let label = position.map(|p| p.to_string()).unwrap_or_else(|| "waiting".to_string());
          log_line("[ws] queue", &label);
        }
        ServerMessage::Start { peer_id } => {
          if let Some(peer_id) = peer_id {
            let peer = create_offerer_peer(peer_id.clone(), signal_tx.clone(), file_info.clone()).await?;
            peers.lock().await.insert(peer_id.clone(), peer);
          }
        }
        ServerMessage::Answer { from, sid, sdp } => {
          if let Some(peer) = peers.lock().await.get(&from).cloned() {
            handle_answer(peer, sid, sdp).await?;
          }
        }
        ServerMessage::Candidate { from, sid, candidate } => {
          if let Some(peer) = peers.lock().await.get(&from).cloned() {
            handle_offer_candidate(peer, sid, candidate).await?;
          }
        }
        ServerMessage::PeerLeft { peer_id } => {
          log_line("[ws] peer-left", &peer_id);
          peers.lock().await.remove(&peer_id);
        }
        _ => {}
      }
    }
  }

  writer.await??;
  Ok(())
}

async fn run_receive(room_id: &str, output_dir: &Path, endpoint: Option<&str>) -> Result<()> {
  let client_id = Uuid::new_v4().to_string();
  let ws_url = build_ws_url(endpoint, room_id, &client_id)?;

  log_line("[ws] connecting", &ws_url.to_string());
  let (ws_stream, _) = connect_async(ws_url.to_string())
    .await
    .context("connect signaling websocket")?;
  let (mut ws_write, mut ws_read) = ws_stream.split();

  let (signal_tx, mut signal_rx) = mpsc::unbounded_channel::<ClientMessage>();

  let writer = tokio::spawn(async move {
    while let Some(msg) = signal_rx.recv().await {
      let text = serde_json::to_string(&msg).map_err(|err| anyhow!(err))?;
      ws_write.send(Message::Text(text)).await.map_err(|err| anyhow!(err))?;
    }
    Ok::<(), anyhow::Error>(())
  });

  let receiver_state: Arc<Mutex<Option<ReceiverState>>> = Arc::new(Mutex::new(None));
  let progress = Arc::new(Mutex::new(ReceiveProgress {
    output_dir: output_dir.to_path_buf(),
    current_file: None,
    file: None,
    expected_size: 0,
    received: 0,
  }));

  while let Some(msg) = ws_read.next().await {
    let msg = msg.context("websocket read")?;
    if let Message::Text(text) = msg {
      let parsed: ServerMessage = match serde_json::from_str(&text) {
        Ok(msg) => msg,
        Err(_) => continue,
      };

      match parsed {
        ServerMessage::Role { role, cid } => {
          log_line("[ws] role", &format!("{role} ({cid})"));
          if role != "answerer" {
            return Err(anyhow!("This command must be the answerer; connect after the sender."));
          }
        }
        ServerMessage::Peers { count } => {
          log_line("[ws] peers", &count.to_string());
        }
        ServerMessage::Wait { position } => {
          let label = position.map(|p| p.to_string()).unwrap_or_else(|| "waiting".to_string());
          log_line("[ws] queue", &label);
        }
        ServerMessage::Start { .. } => {
          let pc = create_peer_connection().await?;
          let tx = signal_tx.clone();
          let receiver_state_for_ice = receiver_state.clone();
          pc.on_ice_candidate(Box::new(move |candidate| {
            let tx = tx.clone();
            let receiver_state = receiver_state_for_ice.clone();
            Box::pin(async move {
              if let Some(candidate) = candidate {
                let candidate = candidate.to_json().unwrap_or_default();
                let guard = receiver_state.lock().await;
                if let Some(state) = guard.as_ref() {
                  if let (Some(peer_id), Some(sid)) = (state.peer_id.clone(), state.active_sid) {
                    let _ = tx.send(ClientMessage::Candidate { to: peer_id, sid, candidate });
                  }
                }
              }
            })
          }));

          let rx_progress = progress.clone();
          pc.on_data_channel(Box::new(move |dc| {
            let rx_progress = rx_progress.clone();
            Box::pin(async move {
              wire_receiver_channel(dc, rx_progress).await;
            })
          }));

          *receiver_state.lock().await = Some(ReceiverState {
            pc,
            peer_id: None,
            active_sid: None,
            pending_candidates: Vec::new(),
            remote_desc_set: false,
          });
        }
        ServerMessage::Offer { from, sid, sdp } => {
          let mut guard = receiver_state.lock().await;
          let state = guard.as_mut().ok_or_else(|| anyhow!("Receiver not initialized"))?;
          state.peer_id = Some(from.clone());
          state.active_sid = Some(sid);
          state.pc.set_remote_description(sdp).await?;
          state.remote_desc_set = true;
          flush_receiver_candidates(state).await?;

          let answer = state.pc.create_answer(None).await?;
          state.pc.set_local_description(answer).await?;
          if let Some(local) = state.pc.local_description().await {
            let _ = signal_tx.send(ClientMessage::Answer { to: from, sid, sdp: local });
          }
        }
        ServerMessage::Candidate { from: _, sid, candidate } => {
          let mut guard = receiver_state.lock().await;
          if let Some(state) = guard.as_mut() {
            handle_receiver_candidate(state, sid, candidate).await?;
          }
        }
        _ => {}
      }
    }
  }

  writer.await??;
  Ok(())
}

async fn create_offerer_peer(
  peer_id: String,
  signal_tx: mpsc::UnboundedSender<ClientMessage>,
  file_info: Arc<FileInfo>,
) -> Result<Arc<OffererPeer>> {
  let pc = create_peer_connection().await?;
  let dc = pc
    .create_data_channel(
      "file",
      Some(RTCDataChannelInit {
        ordered: Some(true),
        ..Default::default()
      }),
    )
    .await?;

  let peer = Arc::new(OffererPeer {
    peer_id: peer_id.clone(),
    pc: pc.clone(),
    state: Arc::new(Mutex::new(OffererPeerState {
      signal_sid: 0,
      active_sid: None,
      pending_candidates: Vec::new(),
      remote_desc_set: false,
      sending: false,
    })),
  });

  let peer_clone = peer.clone();
  let tx = signal_tx.clone();
  pc.on_ice_candidate(Box::new(move |candidate| {
    let peer_clone = peer_clone.clone();
    let tx = tx.clone();
    Box::pin(async move {
      if let Some(candidate) = candidate {
        let candidate = candidate.to_json().unwrap_or_default();
        let sid = peer_clone.state.lock().await.active_sid;
        if let Some(sid) = sid {
          let _ = tx.send(ClientMessage::Candidate {
            to: peer_clone.peer_id.clone(),
            sid,
            candidate,
          });
        }
      }
    })
  }));

  pc.on_peer_connection_state_change(Box::new(move |state: RTCPeerConnectionState| {
    Box::pin(async move {
      log_line("[rtc] connectionState", &format!("{:?}", state));
    })
  }));

  let send_tx = signal_tx.clone();
  let send_peer_id = peer_id.clone();
  let file_info = file_info.clone();
  let send_state = peer.state.clone();
  let dc_for_open = dc.clone();
  dc.on_open(Box::new(move || {
    let send_tx = send_tx.clone();
    let send_peer_id = send_peer_id.clone();
    let file_info = file_info.clone();
    let dc = dc_for_open.clone();
    let send_state = send_state.clone();
    Box::pin(async move {
      let mut guard = send_state.lock().await;
      if guard.sending {
        return;
      }
      guard.sending = true;
      drop(guard);

      if let Err(err) = send_file(&dc, &file_info).await {
        log_line("[send] error", &format!("{err:#}"));
        return;
      }
      let _ = send_tx.send(ClientMessage::TransferDone { peer_id: send_peer_id });
    })
  }));

  send_offer(peer.clone(), signal_tx).await?;

  Ok(peer)
}

async fn send_offer(peer: Arc<OffererPeer>, signal_tx: mpsc::UnboundedSender<ClientMessage>) -> Result<()> {
  let mut guard = peer.state.lock().await;
  if guard.active_sid.is_some() {
    return Ok(());
  }
  guard.signal_sid += 1;
  let sid = guard.signal_sid;
  guard.active_sid = Some(sid);
  drop(guard);

  let offer = peer.pc.create_offer(None).await?;
  peer.pc.set_local_description(offer).await?;
  if let Some(local) = peer.pc.local_description().await {
    let _ = signal_tx.send(ClientMessage::Offer {
      to: peer.peer_id.clone(),
      sid,
      sdp: local,
    });
  }
  Ok(())
}

async fn handle_answer(peer: Arc<OffererPeer>, sid: u64, sdp: RTCSessionDescription) -> Result<()> {
  let mut guard = peer.state.lock().await;
  if guard.active_sid != Some(sid) {
    return Ok(());
  }
  peer.pc.set_remote_description(sdp).await?;
  guard.remote_desc_set = true;
  drop(guard);
  flush_offer_candidates(peer).await?;
  Ok(())
}

async fn handle_offer_candidate(peer: Arc<OffererPeer>, sid: u64, candidate: RTCIceCandidateInit) -> Result<()> {
  let mut guard = peer.state.lock().await;
  if guard.remote_desc_set {
    drop(guard);
    peer.pc.add_ice_candidate(candidate).await?;
  } else {
    guard.pending_candidates.push(PendingCandidate { sid, candidate });
  }
  Ok(())
}

async fn flush_offer_candidates(peer: Arc<OffererPeer>) -> Result<()> {
  let sid = peer.state.lock().await.active_sid;
  if sid.is_none() {
    return Ok(());
  }
  let sid = sid.unwrap();
  let pending = {
    let mut guard = peer.state.lock().await;
    std::mem::take(&mut guard.pending_candidates)
  };
  let mut remaining = Vec::new();
  for item in pending {
    if item.sid == sid {
      peer.pc.add_ice_candidate(item.candidate).await?;
    } else {
      remaining.push(item);
    }
  }
  peer.state.lock().await.pending_candidates.extend(remaining);
  Ok(())
}

async fn handle_receiver_candidate(state: &mut ReceiverState, sid: u64, candidate: RTCIceCandidateInit) -> Result<()> {
  if state.remote_desc_set {
    state.pc.add_ice_candidate(candidate).await?;
  } else {
    state.pending_candidates.push(PendingCandidate { sid, candidate });
  }
  Ok(())
}

async fn flush_receiver_candidates(state: &mut ReceiverState) -> Result<()> {
  let sid = state.active_sid;
  if sid.is_none() {
    return Ok(());
  }
  let sid = sid.unwrap();
  let pending = std::mem::take(&mut state.pending_candidates);
  let mut remaining = Vec::new();
  for item in pending {
    if item.sid == sid {
      state.pc.add_ice_candidate(item.candidate).await?;
    } else {
      remaining.push(item);
    }
  }
  state.pending_candidates = remaining;
  Ok(())
}

async fn wire_receiver_channel(dc: Arc<RTCDataChannel>, progress: Arc<Mutex<ReceiveProgress>>) {
  dc.on_message(Box::new(move |msg: DataChannelMessage| {
    let progress = progress.clone();
    Box::pin(async move {
      if msg.is_string {
        if let Ok(text) = String::from_utf8(msg.data.to_vec()) {
          if let Ok(parsed) = serde_json::from_str::<DataMessage>(&text) {
            match parsed {
              DataMessage::Meta { name, size, mime, encrypted } => {
                if encrypted {
                  log_line("[recv] error", "encrypted files are not supported");
                  return;
                }
                let mut guard = progress.lock().await;
                let path = guard.output_dir.join(&name);
                match File::create(&path).await {
                  Ok(file) => {
                    guard.current_file = Some(path);
                    guard.file = Some(file);
                    guard.expected_size = size;
                    guard.received = 0;
                    log_line("[recv] meta", &format!("{name} ({mime}, {size} bytes)"));
                  }
                  Err(err) => {
                    log_line("[recv] error", &format!("{err:#}"));
                  }
                }
              }
              DataMessage::Done => {
                let mut guard = progress.lock().await;
                guard.file = None;
                if let Some(path) = guard.current_file.take() {
                  log_line("[recv] completed", &path.display().to_string());
                }
              }
            }
          }
        }
        return;
      }

      let mut guard = progress.lock().await;
      if let Some(file) = guard.file.as_mut() {
        if file.write_all(&msg.data).await.is_ok() {
          guard.received += msg.data.len() as u64;
        }
      }
    })
  }));
}

async fn send_file(dc: &RTCDataChannel, info: &FileInfo) -> Result<()> {
  let meta = serde_json::json!({
    "type": "meta",
    "name": info.name,
    "size": info.size,
    "mime": info.mime,
    "encrypted": false,
  });
  let meta_text = serde_json::to_string(&meta)?;
  dc.send_text(meta_text).await?;

  let mut file = File::open(&info.path).await?;
  let mut buffer = vec![0u8; 64 * 1024];
  loop {
    let read = file.read(&mut buffer).await?;
    if read == 0 {
      break;
    }
    dc.send(&Bytes::copy_from_slice(&buffer[..read])).await?;
  }

  dc.send_text("{\"type\":\"done\"}").await?;
  Ok(())
}

async fn load_file_info(path: &Path) -> Result<FileInfo> {
  let metadata = tokio::fs::metadata(path).await?;
  let size = metadata.len();
  let name = path
    .file_name()
    .and_then(|n| n.to_str())
    .ok_or_else(|| anyhow!("Invalid file name"))?
    .to_string();
  let mime = mime_guess::from_path(path)
    .first_or_octet_stream()
    .essence_str()
    .to_string();
  Ok(FileInfo {
    path: path.to_path_buf(),
    name,
    size,
    mime,
  })
}

async fn create_peer_connection() -> Result<Arc<RTCPeerConnection>> {
  let mut media_engine = MediaEngine::default();
  media_engine.register_default_codecs()?;

  let mut registry = Registry::new();
  registry = register_default_interceptors(registry, &mut media_engine)?;

  let api = APIBuilder::new()
    .with_media_engine(media_engine)
    .with_interceptor_registry(registry)
    .build();

  let config = RTCConfiguration {
    ice_servers: vec![RTCIceServer {
      urls: vec!["stun:stun.cloudflare.com:3478".to_string()],
      ..Default::default()
    }],
    ..Default::default()
  };

  let pc = api.new_peer_connection(config).await?;
  Ok(Arc::new(pc))
}

fn build_ws_url(endpoint: Option<&str>, room_id: &str, client_id: &str) -> Result<Url> {
  let mut url = base_endpoint_url(endpoint)?;
  let scheme = match url.scheme() {
    "https" => "wss",
    "http" => "ws",
    "wss" => "wss",
    "ws" => "ws",
    other => return Err(anyhow!("Unsupported endpoint scheme: {other}")),
  };
  url.set_scheme(scheme).map_err(|_| anyhow!("Invalid endpoint scheme"))?;
  url.set_path(&format!("/ws/{room_id}"));
  url.set_query(Some(&format!("cid={client_id}")));
  Ok(url)
}

fn build_room_url(endpoint: Option<&str>, room_id: &str) -> Result<String> {
  let mut url = base_endpoint_url(endpoint)?;
  url.set_path(&format!("/r/{room_id}"));
  url.set_query(None);
  Ok(url.to_string())
}

fn base_endpoint_url(endpoint: Option<&str>) -> Result<Url> {
  let default_endpoint = "https://share-files.karakuri-maker.com";
  let env_endpoint = env::var("SHARE_FILES_ENDPOINT").ok();
  let endpoint = endpoint
    .map(|value| value.to_string())
    .or(env_endpoint)
    .unwrap_or_else(|| default_endpoint.to_string());

  let mut url = Url::parse(&endpoint)?;
  let scheme = match url.scheme() {
    "https" | "http" => url.scheme().to_string(),
    "wss" => "https".to_string(),
    "ws" => "http".to_string(),
    other => return Err(anyhow!("Unsupported endpoint scheme: {other}")),
  };
  url.set_scheme(&scheme).map_err(|_| anyhow!("Invalid endpoint scheme"))?;
  url.set_path("");
  url.set_query(None);
  url.set_fragment(None);
  Ok(url)
}

async fn create_room(endpoint: Option<&str>) -> Result<String> {
  #[derive(Serialize)]
  struct RoomRequest {}

  #[derive(Deserialize)]
  struct RoomResponse {
    #[serde(rename = "roomId")]
    room_id: String,
  }

  let mut url = base_endpoint_url(endpoint)?;
  url.set_path("/api/rooms");
  let client = reqwest::Client::new();
  let response = client
    .post(url)
    .json(&RoomRequest {})
    .send()
    .await
    .context("create room request")?;
  let response = response.error_for_status().context("create room response")?;
  let body: RoomResponse = response.json().await.context("parse room response")?;
  Ok(body.room_id)
}

fn log_line(label: &str, value: &str) {
  let now = chrono::Utc::now().format("%H:%M:%S%.3f");
  println!("[{now}] {label}: {value}");
}
