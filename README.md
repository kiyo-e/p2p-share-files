# Share Files

[日本語](./README.ja.md) | [中文](./README.zh.md)

**Live Demo: https://share-files.karakuri-maker.com/**

A P2P file sharing tool using WebRTC. Transfer files directly between browsers without going through a server.

## Features

- **P2P Transfer**: Files are sent directly between browsers, not through a server
- **E2E Encryption (Optional)**: AES-GCM encryption with key in URL fragment (`#k=...`), never sent to server
- **Serverless**: Runs on Cloudflare Workers + Durable Objects, no file storage on server
- **Multiple Receivers**: One sender can transfer to multiple receivers simultaneously (configurable concurrency)
- **Drag & Drop**: File selection UI supports drag and drop

## How It Works

1. Sender creates a room
2. Share the link (or room code) with receivers
3. Receivers join the room
4. Sender selects a file and sends
5. P2P transfer via WebRTC DataChannel

## Tech Stack

- [Hono](https://hono.dev/) - Lightweight web framework
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge computing
- [Durable Objects](https://developers.cloudflare.com/durable-objects/) - WebSocket signaling
- [Vite](https://vite.dev/) - SSR-enabled build tool
- WebRTC - P2P data transfer

## Prerequisites

- [Bun](https://bun.sh/) runtime

## Development

```sh
bun install
bun run dev
```

Vite dev server runs SSR on `http://localhost:5173`.

## Build

```sh
bun run build
```

## Deploy

```sh
bun run deploy
```

## Generate Cloudflare Types

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```sh
bun run cf-typegen
```

## Bindings Configuration

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.tsx
type Bindings = CloudflareBindings & { ROOM: DurableObjectNamespace }
const app = new Hono<{ Bindings: Bindings }>()
```

## License

MIT
