// Design: see README.md for the P2P signaling flow; this Durable Object pairs with src/index.ts.

type Role = "offerer" | "answerer";

type ServerToClient =
  | { type: "role"; role: Role }
  | { type: "peers"; count: number }
  | { type: "peer-left" }
  | { type: "room-full" };

function toText(message: ArrayBuffer | string) {
  return typeof message === "string" ? message : new TextDecoder().decode(message);
}

type Bindings = CloudflareBindings;

const DurableObjectBase =
  (globalThis as { DurableObject?: typeof DurableObject }).DurableObject ??
  class {
    ctx: DurableObjectState;
    constructor(state: DurableObjectState) {
      this.ctx = state;
    }
  };

export class Room extends DurableObjectBase {
  private ctx: DurableObjectState;

  constructor(state: DurableObjectState, env: Bindings) {
    super(state, env);
    this.ctx = state;
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }
    if (request.method !== "GET") {
      return new Response("Expected GET", { status: 400 });
    }

    const existing = this.ctx.getWebSockets().length;
    if (existing >= 2) {
      return new Response("Room is full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    const role: Role = existing === 0 ? "offerer" : "answerer";
    server.send(
      JSON.stringify({ type: "role", role } satisfies ServerToClient)
    );

    this.broadcastPeers();

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    const text = toText(message);
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) other.send(text);
    }
  }

  webSocketClose(ws: WebSocket) {
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) {
        other.send(JSON.stringify({ type: "peer-left" } satisfies ServerToClient));
      }
    }
    this.broadcastPeers();
  }

  webSocketError() {
    this.broadcastPeers();
  }

  private broadcastPeers() {
    const count = this.ctx.getWebSockets().length;
    const payload = JSON.stringify({ type: "peers", count } satisfies ServerToClient);
    for (const socket of this.ctx.getWebSockets()) socket.send(payload);
  }
}
