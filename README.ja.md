# Share Files

[English](./README.md) | [中文](./README.zh.md)

**デモサイト: https://share-files.karakuri-maker.com/**

WebRTCを使ったP2Pファイル共有ツール。サーバーを経由せずブラウザ間で直接ファイルを転送します。

## 特徴

- **P2P転送**: ファイルはサーバーを経由せず、ブラウザ間で直接送受信
- **E2E暗号化（オプション）**: リンクの`#k=...`部分に鍵を含めることで、サーバーに鍵を送らずにAES-GCM暗号化
- **サーバーレス**: Cloudflare Workers + Durable Objectsで動作、ファイルはサーバーに保存されない
- **複数受信者対応**: 1人の送信者から複数人が同時にファイルを受信可能（同時接続数は設定可能）
- **ドラッグ＆ドロップ**: ファイル選択UIはドラッグ＆ドロップに対応

## 動作の流れ

1. 送信者がルームを作成
2. リンク（またはルームコード）を受信者に共有
3. 受信者がルームに参加
4. 送信者がファイルを選択して送信
5. WebRTC DataChannelでP2P転送

## 技術スタック

- [Hono](https://hono.dev/) - 軽量Webフレームワーク
- [Cloudflare Workers](https://workers.cloudflare.com/) - エッジコンピューティング
- [Durable Objects](https://developers.cloudflare.com/durable-objects/) - WebSocketシグナリング
- [Vite](https://vite.dev/) - SSR対応ビルドツール
- WebRTC - P2Pデータ転送

## 必要環境

- [Bun](https://bun.sh/) ランタイム

## 開発

```sh
bun install
bun run dev
```

Vite開発サーバーが `http://localhost:5173` でSSRを実行します。

## ビルド

```sh
bun run build
```

## デプロイ

```sh
bun run deploy
```

## Cloudflare型生成

[Worker設定に基づいて型を生成/同期するには](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```sh
bun run cf-typegen
```

## Bindings設定

`Hono`のインスタンス化時に`CloudflareBindings`をジェネリクスとして渡します:

```ts
// src/index.tsx
type Bindings = CloudflareBindings & { ROOM: DurableObjectNamespace }
const app = new Hono<{ Bindings: Bindings }>()
```

## ライセンス

MIT
