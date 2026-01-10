# Add a Rust CLI for WebRTC file transfers

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This ExecPlan follows /workspace/p2p-share-files/PLANS.md.

## Purpose / Big Picture

Provide a Rust CLI that can send and receive files over the existing WebRTC signaling flow so terminals can interoperate with browsers or other terminals on Linux and macOS. Observable behavior: running the CLI in send/receive modes can complete a file transfer over a room ID using the demo endpoint.

## Progress

- [x] (2025-09-27 10:18Z) Add Rust CLI scaffold with WebRTC signaling/datachannel logic.
- [x] (2025-09-27 10:18Z) Document CLI usage and add CI build workflow.

Rules:
- Use timestamps.
- Every stopping point must update this section (split partial items into “done vs remaining”).

## Surprises & Discoveries

- Observation: ExecPlan files are ignored by default in .gitignore.
  Evidence: .gitignore includes `.agents/execplans/*`.

## Decision Log

- Decision: Implement CLI using Rust + webrtc crate with tokio-tungstenite for signaling.
  Rationale: Bun does not provide stable WebRTC bindings; Rust has mature WebRTC crates for native builds.
  Date/Author: 2025-09-27 / agent

## Outcomes & Retrospective

Added a Rust CLI in `cli/` for send/receive, documented usage, and added a GitHub Actions build workflow. Remaining gaps: encryption support and room creation are not implemented.

## Context and Orientation

- Web app entrypoint: `src/index.tsx` exposes `/ws/:roomId` WebSocket signaling.
- Signaling protocol and file transfer flow live in `src/client/room.tsx`.
- Durable Object signaling server is `src/room.ts`.
- Demo endpoint is `https://share-files.karakuri-maker.com/` and its WebSocket path is `/ws/:roomId`.

## Plan of Work

Add a Rust CLI under `cli/` with subcommands `send` and `receive`, using WebRTC DataChannel for file transfer and the same JSON signaling messages as the browser client. Add an environment-variable override for the endpoint. Update README files with CLI usage. Add a GitHub Actions workflow to build the CLI for Linux and macOS. Update .gitignore to allow the ExecPlan to be committed.

## Concrete Steps

- Create `cli/Cargo.toml` and `cli/src/main.rs` with tokio + webrtc + websocket dependencies.
- Implement signaling connection to `wss://<endpoint>/ws/:roomId?cid=...`.
- Implement offerer and answerer flows mirroring browser logic for offer/answer/candidates.
- Implement file send (meta JSON -> chunk bytes -> done JSON) and file receive (write to disk).
- Update `README.md` and `README.ja.md` with CLI instructions.
- Add `.github/workflows/cli-build.yml` to build on ubuntu/macos.
- Update `.gitignore` to allow the execplan file.

## Validation and Acceptance

- Running `cargo run --release -- send --room-id <id> --file <path>` and `cargo run --release -- receive --room-id <id>` in two terminals transfers a file successfully.
- CLI can connect to the demo endpoint by default and respects the environment override.
- GitHub Actions workflow builds the CLI on ubuntu and macos.

## Idempotence and Recovery

- Re-running `cargo build` is safe; it reuses cached deps.
- If the CLI cannot connect, ensure the endpoint and room ID are correct, then retry.

## Artifacts and Notes

- None yet.

## Interfaces and Dependencies

- Rust crates: `webrtc`, `tokio`, `tokio-tungstenite`, `serde`, `serde_json`, `clap`, `uuid`, `mime_guess`, `bytes`.
- Public CLI interface: `send` and `receive` subcommands with explicit flags.
- Environment variable: `SHARE_FILES_ENDPOINT` for the demo endpoint override.
