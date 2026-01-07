const $ = (id: string) => document.getElementById(id);

const encryptToggle = $("encryptToggle") as HTMLInputElement | null;
const createBtn = $("createBtn") as HTMLButtonElement | null;
const joinCode = $("joinCode") as HTMLInputElement | null;
const joinBtn = $("joinBtn") as HTMLButtonElement | null;

if (encryptToggle && createBtn && joinCode && joinBtn) {
  createBtn.onclick = async () => {
    setHomeBusy(true);
    try {
      const { roomId } = await apiCreateRoom();
      const useEncrypt = encryptToggle.checked;
      if (useEncrypt) {
        const rawKey = crypto.getRandomValues(new Uint8Array(32));
        const k = b64urlEncode(rawKey);
        location.href = `/r/${roomId}#k=${k}`;
      } else {
        location.href = `/r/${roomId}`;
      }
    } finally {
      setHomeBusy(false);
    }
  };

  joinBtn.onclick = () => {
    const code = joinCode.value.trim().toUpperCase();
    if (!code) return;
    location.href = `/r/${code}${location.hash || ""}`;
  };
}

function setHomeBusy(b: boolean) {
  if (!createBtn || !joinBtn || !encryptToggle) return;
  createBtn.disabled = b;
  joinBtn.disabled = b;
  encryptToggle.disabled = b;
}

async function apiCreateRoom(): Promise<{ roomId: string }> {
  const res = await fetch("/api/rooms", { method: "POST" });
  if (!res.ok) throw new Error("ルーム作成に失敗しました");
  return res.json();
}

function b64urlEncode(u8: Uint8Array) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
