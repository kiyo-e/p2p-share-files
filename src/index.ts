import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { Room } from "./room";
import { RoomPage, TopPage } from "./ui";

type Bindings = CloudflareBindings & {
  ROOM: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", jsxRenderer());

app.get("/", (c) => {
  return c.render(TopPage());
});

app.get("/r/:roomId", (c) => {
  return c.render(RoomPage({ roomId: c.req.param("roomId") }));
});

app.post("/api/rooms", (c) => {
  const roomId = generateRoomId(10);
  return c.json({ roomId });
});

app.get("/ws/:roomId", (c) => {
  const upgrade = c.req.header("Upgrade");
  if (!upgrade || upgrade.toLowerCase() !== "websocket") {
    return c.text("Expected Upgrade: websocket", 426);
  }

  const roomId = c.req.param("roomId");
  const id = c.env.ROOM.idFromName(roomId);
  const stub = c.env.ROOM.get(id);
  return stub.fetch(c.req.raw);
});

app.get("*", (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export { Room };
export default app;

function generateRoomId(len: number) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
