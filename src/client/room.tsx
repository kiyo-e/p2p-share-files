/** @jsxImportSource hono/jsx/dom */
/**
 * Room client app for share-files.
 * See README.md; pairs with src/ui/room.tsx.
 */

import { render, useCallback, useEffect, useMemo, useRef, useState } from "hono/jsx/dom";

type RoomRole = "offerer" | "answerer" | null;

type RoomMessage =
  | { type: "role"; role: "offerer" | "answerer" }
  | { type: "peers"; count: number }
  | { type: "peer-left" }
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "candidate"; candidate: RTCIceCandidateInit };

type IncomingMeta = {
  type: "meta";
  name: string;
  size: number;
  mime: string;
  encrypted: boolean;
};

type DoneMessage = { type: "done" };

type DataMessage = IncomingMeta | DoneMessage;

type OutgoingMeta = IncomingMeta;

type PendingCandidate = RTCIceCandidateInit;

type Nullable<T> = T | null;

type AnyWebSocket = WebSocket;

type DataChannel = RTCDataChannel;

type BufferLike = ArrayBuffer | Blob;

type RoomCryptoKey = CryptoKey | null;

type DownloadInfo = {
  url: string;
  name: string;
  size: number;
};

const clientId = getClientId();

const root = document.querySelector("main.container");
const roomId = document.body.dataset.roomId;
if (root && roomId && document.getElementById("roomView")) {
  render(<RoomApp roomId={roomId} />, root);
}

type RoomAppProps = {
  roomId: string;
};

function RoomApp({ roomId }: RoomAppProps) {
  const [status, setStatus] = useState("初期化中...");
  const [role, setRole] = useState<RoomRole>(null);
  const [peers, setPeers] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0 });
  const [recvProgress, setRecvProgress] = useState({ got: 0, total: 0 });
  const [download, setDownload] = useState<DownloadInfo | null>(null);
  const [dataChannelReady, setDataChannelReady] = useState(false);
  const [dropHover, setDropHover] = useState(false);

  const roleRef = useRef<RoomRole>(role);
  const peersRef = useRef(peers);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<AnyWebSocket | null>(null);
  const dcRef = useRef<DataChannel | null>(null);
  const cryptoKeyRef = useRef<RoomCryptoKey>(null);
  const remoteDescSetRef = useRef(false);
  const offerInFlightRef = useRef(false);
  const pendingCandidatesRef = useRef<PendingCandidate[]>([]);
  const incomingMetaRef = useRef<IncomingMeta | null>(null);
  const recvChunksRef = useRef<Uint8Array[]>([]);
  const recvBytesRef = useRef(0);
  const downloadUrlRef = useRef<string | null>(null);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  const handleCopyLink = useCallback(() => {
    copyText(location.href);
  }, []);

  const handleCopyCode = useCallback(() => {
    copyText(roomId);
  }, [roomId]);

  const handleDragOver = useCallback((ev: DragEvent) => {
    ev.preventDefault();
    setDropHover(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropHover(false);
  }, []);

  const handleDrop = useCallback((ev: DragEvent) => {
    ev.preventDefault();
    setDropHover(false);
    const f = ev.dataTransfer?.files?.[0];
    if (f) setSelectedFile(f);
  }, []);

  const handleFileInput = useCallback((ev: Event) => {
    const input = ev.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (f) setSelectedFile(f);
  }, []);

  const finalizeDownload = useCallback(async () => {
    const meta = incomingMetaRef.current;
    if (!meta) return;
    setStatus("ファイル生成中...");

    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
    }

    const blob = new Blob(recvChunksRef.current, { type: meta.mime });
    const url = URL.createObjectURL(blob);
    downloadUrlRef.current = url;

    setDownload({ url, name: meta.name, size: meta.size });
    setStatus("受信完了");
  }, []);

  const sendFile = useCallback(async (file: File) => {
    const dc = dcRef.current;
    if (!dc) return;

    const encrypted = !!cryptoKeyRef.current;
    const meta: OutgoingMeta = {
      type: "meta",
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      encrypted,
    };
    dc.send(JSON.stringify(meta));

    setStatus("送信中...");
    setSendProgress({ sent: 0, total: file.size });

    let sent = 0;

    dc.bufferedAmountLowThreshold = 4 * 1024 * 1024;
    const waitDrain = () =>
      new Promise<void>((resolve) => {
        if (dc.bufferedAmount <= dc.bufferedAmountLowThreshold) return resolve();
        dc.onbufferedamountlow = () => {
          dc.onbufferedamountlow = null;
          resolve();
        };
      });

    const sendChunk = async (value: Uint8Array) => {
      const chunk = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      let payload: ArrayBuffer = chunk;
      if (encrypted) payload = await encryptChunk(chunk, cryptoKeyRef.current);
      dc.send(payload);
      sent += value.byteLength;
      setSendProgress({ sent, total: file.size });
      if (dc.bufferedAmount > 8 * 1024 * 1024) await waitDrain();
    };

    const chunkSize = 16 * 1024;
    let offset = 0;
    while (offset < file.size) {
      const slice = file.slice(offset, offset + chunkSize);
      const buf = await slice.arrayBuffer();
      const value = new Uint8Array(buf);
      if (value.byteLength === 0) break;
      await sendChunk(value);
      offset += value.byteLength;
    }

    dc.send(JSON.stringify({ type: "done" } satisfies DoneMessage));
    setStatus("送信完了");
  }, []);

  const handleSend = useCallback(async () => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    if (!selectedFile) return;
    if (peersRef.current < 2) return;
    await sendFile(selectedFile);
  }, [selectedFile, sendFile]);

  useEffect(() => {
    const boot = async () => {
      setStatus("シグナリング接続中...");

      const keyParam = new URLSearchParams(location.hash.slice(1)).get("k");
      cryptoKeyRef.current = keyParam ? await importAesKey(b64urlDecode(keyParam)) : null;

      const ws = await connectSignaling(roomId, clientId);
      wsRef.current = ws;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
      });
      pcRef.current = pc;

      pc.onicecandidate = (ev) => {
        if (ev.candidate) sendWS(ws, { type: "candidate", candidate: ev.candidate });
      };

      pc.oniceconnectionstatechange = () => {
        console.info("[rtc] iceConnectionState:", pc.iceConnectionState);
      };

      pc.onicegatheringstatechange = () => {
        console.info("[rtc] iceGatheringState:", pc.iceGatheringState);
      };

      pc.onsignalingstatechange = () => {
        console.info("[rtc] signalingState:", pc.signalingState);
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        console.info("[rtc] connectionState:", s);
        if (s === "connected") setStatus("P2P接続完了");
        else if (s === "failed") setStatus("P2P接続失敗（ネットワーク条件の可能性）");
        else if (s === "connecting") setStatus("P2P接続中...");
        else setStatus(`状態: ${s}`);
      };

      pc.ondatachannel = (ev) => {
        dcRef.current = ev.channel;
        wireDataChannel(ev.channel);
      };

      const ensureOffer = async () => {
        const currentPc = pcRef.current;
        if (!currentPc) return;
        if (roleRef.current !== "offerer") return;
        if (peersRef.current < 2) return;
        if (offerInFlightRef.current) return;
        if (currentPc.signalingState !== "stable") return;
        if (currentPc.localDescription) return;
        offerInFlightRef.current = true;
        try {
          const offer = await currentPc.createOffer();
          await currentPc.setLocalDescription(offer);
          sendWS(ws, { type: "offer", sdp: currentPc.localDescription });
        } finally {
          offerInFlightRef.current = false;
        }
      };

      const flushCandidates = async () => {
        const currentPc = pcRef.current;
        if (!currentPc) return;
        const pending = pendingCandidatesRef.current;
        while (pending.length) {
          const c = pending.shift();
          if (c) await currentPc.addIceCandidate(c);
        }
      };

      const wireDataChannel = (ch: DataChannel) => {
        ch.binaryType = "arraybuffer";
        ch.onopen = () => {
          console.info("[rtc] datachannel open");
          setStatus("データチャネル準備完了");
          setDataChannelReady(true);
        };
        ch.onclose = () => {
          console.info("[rtc] datachannel close");
          setStatus("データチャネル切断");
          setDataChannelReady(false);
        };
        ch.onerror = () => {
          console.warn("[rtc] datachannel error");
          setStatus("データチャネルエラー");
          setDataChannelReady(false);
        };

        ch.onmessage = async (ev) => {
          if (typeof ev.data === "string") {
            const m = safeJson(ev.data) as DataMessage | null;
            if (!m) return;

            if (m.type === "meta") {
              incomingMetaRef.current = m;
              recvChunksRef.current = [];
              recvBytesRef.current = 0;
              setRecvProgress({ got: 0, total: m.size });

              if (m.encrypted && !cryptoKeyRef.current) {
                setStatus("暗号化リンクの鍵が見つかりません（#k=... が必要）");
                return;
              }
              setStatus(`受信中: ${m.name}`);
            }

            if (m.type === "done") {
              await finalizeDownload();
            }
            return;
          }

          if (!incomingMetaRef.current) return;
          const ab = await toArrayBuffer(ev.data as BufferLike);

          let plain = ab;
          if (incomingMetaRef.current.encrypted) {
            plain = await decryptChunk(ab, cryptoKeyRef.current);
          }
          recvChunksRef.current.push(new Uint8Array(plain));
          recvBytesRef.current += plain.byteLength;
          setRecvProgress({ got: recvBytesRef.current, total: incomingMetaRef.current.size });
        };
      };

      ws.onmessage = async (ev) => {
        const msg = safeJson(ev.data) as RoomMessage | null;
        if (!msg) return;
        console.info("[ws] message:", msg.type);

        if (msg.type === "role") {
          setRole(msg.role);
          if (msg.role === "offerer") {
            dcRef.current = pc.createDataChannel("file", { ordered: true });
            wireDataChannel(dcRef.current);
          }
          return;
        }

        if (msg.type === "peers") {
          setPeers(msg.count);
          if (msg.count < 2) setStatus("相手の参加待ち...");
          else if (pc.connectionState !== "connected") setStatus("P2P確立中...");
          ensureOffer();
          return;
        }

        if (msg.type === "peer-left") {
          setStatus("相手が退出しました");
          setDataChannelReady(false);
          return;
        }

        if (msg.type === "offer") {
          await pc.setRemoteDescription(msg.sdp);
          remoteDescSetRef.current = true;
          await flushCandidates();

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendWS(ws, { type: "answer", sdp: pc.localDescription });
          return;
        }

        if (msg.type === "answer") {
          await pc.setRemoteDescription(msg.sdp);
          remoteDescSetRef.current = true;
          await flushCandidates();
          return;
        }

        if (msg.type === "candidate") {
          if (!remoteDescSetRef.current) pendingCandidatesRef.current.push(msg.candidate);
          else await pc.addIceCandidate(msg.candidate);
        }
      };

      ws.onclose = () => setStatus("シグナリング切断");
      ws.onerror = () => console.warn("[ws] error");
    };

    boot().catch((e) => {
      setStatus(`エラー: ${String(e?.message || e)}`);
    });

    return () => {
      wsRef.current?.close();
      dcRef.current?.close();
      pcRef.current?.close();
      if (downloadUrlRef.current) {
        URL.revokeObjectURL(downloadUrlRef.current);
        downloadUrlRef.current = null;
      }
    };
  }, [roomId, finalizeDownload]);

  const roleLabel = useMemo(() => {
    if (role === "offerer") return "送信側（offerer）";
    if (role === "answerer") return "受信側（answerer）";
    return "—";
  }, [role]);

  const peersLabel = useMemo(() => String(peers), [peers]);

  const sendPct = useMemo(
    () => progressPercent(sendProgress.sent, sendProgress.total),
    [sendProgress]
  );
  const sendText = useMemo(
    () => progressText(sendProgress.sent, sendProgress.total),
    [sendProgress]
  );

  const recvPct = useMemo(
    () => progressPercent(recvProgress.got, recvProgress.total),
    [recvProgress]
  );
  const recvText = useMemo(
    () => progressText(recvProgress.got, recvProgress.total),
    [recvProgress]
  );

  const selectedFileLabel = useMemo(() => {
    if (!selectedFile) return "";
    return `${selectedFile.name} (${formatBytes(selectedFile.size)})`;
  }, [selectedFile]);

  const canSend = role === "offerer" && dataChannelReady && !!selectedFile && peers >= 2;
  const showSender = role === "offerer";
  const showReceiver = role === "answerer";

  return (
    <section id="roomView" class="card room">
      <div class="roomHeader">
        <div class="roomTitle">
          <div class="eyebrow">ROOM—SESSION</div>
          <h2>
            ROOM <span id="roomIdLabel" class="mono">{roomId}</span>
          </h2>
          <div id="status" class="status">{status}</div>
        </div>
        <div class="right">
          <button id="copyLinkBtn" class="btn" onClick={handleCopyLink}>LINK</button>
          <button id="copyCodeBtn" class="btn" onClick={handleCopyCode}>CODE</button>
        </div>
      </div>

      <div class="roomGrid">
        <div class="roomSide">
          <div class="kv">
            <div class="k">ROLE</div>
            <div class="v" id="roleLabel">{roleLabel}</div>
            <div class="k">PEERS</div>
            <div class="v" id="peersLabel">{peersLabel}</div>
          </div>
          <div class="sideCard muted small">
            暗号化ONの場合、リンクの「#」以降に復号鍵が含まれます（サーバには送られません）。
          </div>
        </div>

        <div class="roomMain">
          <div id="senderPane" class={`pane${showSender ? "" : " hidden"}`}>
            <div
              id="drop"
              class={`drop${dropHover ? " hover" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div class="dropTitle">DROP FILE HERE</div>
              <div class="muted small">または</div>
              <label class="btn">
                SELECT
                <input id="fileInput" type="file" hidden onChange={handleFileInput} />
              </label>
            </div>

            <div class="row gap wrap">
              <button id="sendBtn" class="btn primary" disabled={!canSend} onClick={handleSend}>
                SEND
              </button>
              <div class="muted small" id="fileInfo">{selectedFileLabel}</div>
            </div>

            <div class="progress">
              <div class="bar">
                <div
                  id="sendBar"
                  class="fill"
                  style={{ width: `${sendPct}%` }}
                ></div>
              </div>
              <div class="muted small" id="sendText">{sendText}</div>
            </div>
          </div>

          <div id="receiverPane" class={`pane${showReceiver ? "" : " hidden"}`}>
            <div class="muted">送信側がファイルを選ぶのを待っています...</div>

            <div class="progress">
              <div class="bar">
                <div
                  id="recvBar"
                  class="fill"
                  style={{ width: `${recvPct}%` }}
                ></div>
              </div>
              <div class="muted small" id="recvText">{recvText}</div>
            </div>

            <div id="downloadArea" class={download ? "" : "hidden"}>
              <a
                id="downloadLink"
                class="btn primary"
                href={download?.url ?? "#"}
                download={download?.name}
              >
                DOWNLOAD
              </a>
              <div id="downloadMeta" class="muted small">
                {download ? `${download.name} (${formatBytes(download.size)})` : ""}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** ---------- signaling ---------- */
function wsUrl(path: string) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

function connectSignaling(roomId: string, clientId: string) {
  return new Promise<AnyWebSocket>((resolve, reject) => {
    const url = new URL(wsUrl(`/ws/${roomId}`));
    url.searchParams.set("cid", clientId);
    const ws = new WebSocket(url.toString());
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("WebSocket接続に失敗しました"));
  });
}

function sendWS(ws: AnyWebSocket, obj: RoomMessage) {
  ws.send(JSON.stringify(obj));
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** ---------- UI helpers ---------- */
function progressPercent(sent: number, total: number) {
  return total ? Math.floor((sent / total) * 100) : 0;
}

function progressText(sent: number, total: number) {
  if (!total) return "0%";
  const pct = progressPercent(sent, total);
  return `${pct}% (${formatBytes(sent)} / ${formatBytes(total)})`;
}

async function copyText(s: string) {
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = s;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function formatBytes(n: number) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let x = n;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function getClientId() {
  const key = "share-files-client-id";
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

async function toArrayBuffer(data: BufferLike) {
  if (data instanceof ArrayBuffer) return data;
  return data.arrayBuffer();
}

/** ---------- crypto (optional E2E) ---------- */
async function importAesKey(raw: Uint8Array) {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptChunk(plainAb: ArrayBuffer, key: RoomCryptoKey) {
  if (!key) return plainAb;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainAb);
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return out.buffer;
}

async function decryptChunk(frameAb: ArrayBuffer, key: RoomCryptoKey) {
  if (!key) return frameAb;
  const u8 = new Uint8Array(frameAb);
  const iv = u8.slice(0, 12);
  const ct = u8.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return pt;
}

function b64urlDecode(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
