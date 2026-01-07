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

const $ = (id: string) => document.getElementById(id);

const roomIdLabel = $("roomIdLabel");
const statusEl = $("status");
const roleLabel = $("roleLabel");
const peersLabel = $("peersLabel");
const copyLinkBtn = $("copyLinkBtn");
const copyCodeBtn = $("copyCodeBtn");
const clientId = getClientId();

const senderPane = $("senderPane");
const receiverPane = $("receiverPane");

const drop = $("drop");
const fileInput = $("fileInput") as HTMLInputElement | null;
const sendBtn = $("sendBtn") as HTMLButtonElement | null;
const fileInfo = $("fileInfo");
const sendBar = $("sendBar");
const sendText = $("sendText");

const recvBar = $("recvBar");
const recvText = $("recvText");
const downloadArea = $("downloadArea");
const downloadLink = $("downloadLink") as HTMLAnchorElement | null;
const downloadMeta = $("downloadMeta");

const roomId = document.body.dataset.roomId;

if (
  roomId &&
  roomIdLabel &&
  statusEl &&
  roleLabel &&
  peersLabel &&
  copyLinkBtn &&
  copyCodeBtn &&
  senderPane &&
  receiverPane &&
  drop &&
  fileInput &&
  sendBtn &&
  fileInfo &&
  sendBar &&
  sendText &&
  recvBar &&
  recvText &&
  downloadArea &&
  downloadLink &&
  downloadMeta
) {
  bootRoom(roomId).catch((e) => {
    setStatus(`エラー: ${String(e?.message || e)}`);
  });
}

async function bootRoom(roomId: string) {
  roomIdLabel!.textContent = roomId;
  copyLinkBtn!.onclick = () => copyText(location.href);
  copyCodeBtn!.onclick = () => copyText(roomId);

  setStatus("シグナリング接続中...");
  const ws = await connectSignaling(roomId, clientId);

  let role: RoomRole = null;
  let peers = 0;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
  });

  let dc: Nullable<DataChannel> = null;
  let remoteDescSet = false;
  const pendingCandidates: PendingCandidate[] = [];
  let offerInFlight = false;

  const keyParam = new URLSearchParams(location.hash.slice(1)).get("k");
  const cryptoKey = keyParam ? await importAesKey(b64urlDecode(keyParam)) : null;

  let selectedFile: Nullable<File> = null;
  let incomingMeta: IncomingMeta | null = null;
  let recvChunks: Uint8Array[] = [];
  let recvBytes = 0;

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
    dc = ev.channel;
    wireDataChannel(dc);
  };

  async function ensureOffer() {
    if (role !== "offerer") return;
    if (peers < 2) return;
    if (offerInFlight) return;
    if (pc.signalingState !== "stable") return;
    if (pc.localDescription) return;
    offerInFlight = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendWS(ws, { type: "offer", sdp: pc.localDescription });
    } finally {
      offerInFlight = false;
    }
  }

  ws.onmessage = async (ev) => {
    const msg = safeJson(ev.data) as RoomMessage | null;
    if (!msg) return;
    console.info("[ws] message:", msg.type);

    if (msg.type === "role") {
      role = msg.role;
      roleLabel!.textContent = role === "offerer" ? "送信側（offerer）" : "受信側（answerer）";
      if (role === "offerer") {
        senderPane!.classList.remove("hidden");
        receiverPane!.classList.add("hidden");
        setupSenderUI();
      } else {
        receiverPane!.classList.remove("hidden");
        senderPane!.classList.add("hidden");
      }
      if (role === "offerer") {
        dc = pc.createDataChannel("file", { ordered: true });
        wireDataChannel(dc);
      }
      return;
    }

    if (msg.type === "peers") {
      peers = msg.count;
      peersLabel!.textContent = String(peers);
      if (peers < 2) setStatus("相手の参加待ち...");
      else if (pc.connectionState !== "connected") setStatus("P2P確立中...");
      ensureOffer();
      if (role === "offerer") {
        sendBtn!.disabled = !(selectedFile && dc && dc.readyState === "open" && peers >= 2);
      }
      return;
    }

    if (msg.type === "peer-left") {
      setStatus("相手が退出しました");
      sendBtn!.disabled = true;
      return;
    }

    if (msg.type === "offer") {
      await pc.setRemoteDescription(msg.sdp);
      remoteDescSet = true;
      await flushCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWS(ws, { type: "answer", sdp: pc.localDescription });
      return;
    }

    if (msg.type === "answer") {
      await pc.setRemoteDescription(msg.sdp);
      remoteDescSet = true;
      await flushCandidates();
      return;
    }

    if (msg.type === "candidate") {
      if (!remoteDescSet) pendingCandidates.push(msg.candidate);
      else await pc.addIceCandidate(msg.candidate);
    }
  };

  ws.onclose = () => setStatus("シグナリング切断");
  ws.onerror = () => console.warn("[ws] error");

  function wireDataChannel(ch: DataChannel) {
    ch.binaryType = "arraybuffer";
    ch.onopen = () => {
      console.info("[rtc] datachannel open");
      setStatus("データチャネル準備完了");
      if (role === "offerer") sendBtn!.disabled = !selectedFile || peers < 2;
    };
    ch.onclose = () => {
      console.info("[rtc] datachannel close");
      setStatus("データチャネル切断");
    };
    ch.onerror = () => {
      console.warn("[rtc] datachannel error");
      setStatus("データチャネルエラー");
    };

    ch.onmessage = async (ev) => {
      if (typeof ev.data === "string") {
        const m = safeJson(ev.data) as DataMessage | null;
        if (!m) return;

        if (m.type === "meta") {
          incomingMeta = m;
          recvChunks = [];
          recvBytes = 0;
          setRecvProgress(0, incomingMeta.size);

          if (incomingMeta.encrypted && !cryptoKey) {
            setStatus("暗号化リンクの鍵が見つかりません（#k=... が必要）");
            return;
          }
          setStatus(`受信中: ${incomingMeta.name}`);
        }

        if (m.type === "done") {
          await finalizeDownload();
        }
        return;
      }

      if (!incomingMeta) return;
      const ab = await toArrayBuffer(ev.data as BufferLike);

      let plain = ab;
      if (incomingMeta.encrypted) {
        plain = await decryptChunk(ab, cryptoKey);
      }
      recvChunks.push(new Uint8Array(plain));
      recvBytes += plain.byteLength;
      setRecvProgress(recvBytes, incomingMeta.size);
    };
  }

  async function flushCandidates() {
    while (pendingCandidates.length) {
      const c = pendingCandidates.shift();
      await pc.addIceCandidate(c);
    }
  }

  function setupSenderUI() {
    drop!.ondragover = (e) => {
      e.preventDefault();
      drop!.classList.add("hover");
    };
    drop!.ondragleave = () => drop!.classList.remove("hover");
    drop!.ondrop = (e) => {
      e.preventDefault();
      drop!.classList.remove("hover");
      const f = e.dataTransfer?.files?.[0];
      if (f) pickFile(f);
    };
    fileInput!.onchange = () => {
      const f = fileInput!.files?.[0];
      if (f) pickFile(f);
    };

    sendBtn!.onclick = async () => {
      if (!dc || dc.readyState !== "open" || !selectedFile) return;
      if (peers < 2) return;
      await sendFile(selectedFile);
    };
  }

  function pickFile(f: File) {
    selectedFile = f;
    fileInfo!.textContent = `${f.name} (${formatBytes(f.size)})`;
    sendBtn!.disabled = !(dc && dc.readyState === "open" && peers >= 2);
  }

  async function sendFile(file: File) {
    const encrypted = !!cryptoKey;
    const meta: OutgoingMeta = {
      type: "meta",
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      encrypted,
    };
    dc!.send(JSON.stringify(meta));

    setStatus("送信中...");
    setSendProgress(0, file.size);

    let sent = 0;

    dc!.bufferedAmountLowThreshold = 4 * 1024 * 1024;
    const waitDrain = () =>
      new Promise<void>((resolve) => {
        if (dc!.bufferedAmount <= dc!.bufferedAmountLowThreshold) return resolve();
        dc!.onbufferedamountlow = () => {
          dc!.onbufferedamountlow = null;
          resolve();
        };
      });

    const sendChunk = async (value: Uint8Array) => {
      const chunk = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      let payload: ArrayBuffer = chunk;
      if (encrypted) payload = await encryptChunk(chunk, cryptoKey);
      dc!.send(payload);
      sent += value.byteLength;
      setSendProgress(sent, file.size);
      if (dc!.bufferedAmount > 8 * 1024 * 1024) await waitDrain();
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

    dc!.send(JSON.stringify({ type: "done" } satisfies DoneMessage));
    setStatus("送信完了");
  }

  async function finalizeDownload() {
    if (!incomingMeta) return;
    setStatus("ファイル生成中...");

    const blob = new Blob(recvChunks, { type: incomingMeta.mime });
    const url = URL.createObjectURL(blob);

    downloadLink!.href = url;
    downloadLink!.download = incomingMeta.name;
    downloadMeta!.textContent = `${incomingMeta.name} (${formatBytes(incomingMeta.size)})`;

    downloadArea!.classList.remove("hidden");
    setStatus("受信完了");
  }
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
function setStatus(text: string) {
  statusEl!.textContent = text;
}

function setSendProgress(sent: number, total: number) {
  const pct = total ? Math.floor((sent / total) * 100) : 0;
  sendBar!.style.width = `${pct}%`;
  sendText!.textContent = `${pct}% (${formatBytes(sent)} / ${formatBytes(total)})`;
}

function setRecvProgress(got: number, total: number) {
  const pct = total ? Math.floor((got / total) * 100) : 0;
  recvBar!.style.width = `${pct}%`;
  recvText!.textContent = `${pct}% (${formatBytes(got)} / ${formatBytes(total)})`;
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
