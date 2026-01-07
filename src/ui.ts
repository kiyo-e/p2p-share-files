/**
 * UI rendering module for the share-files P2P file sharing application.
 * Implements a brutalist design aesthetic with bold typography and stark visual elements.
 */

import { html } from "hono/html";

type PageOptions = {
  roomId?: string;
};

export function renderPage({ roomId }: PageOptions) {
  const activeRoom = roomId ?? "";
  const homeHidden = activeRoom ? "hidden" : "";
  const roomHidden = activeRoom ? "" : "hidden";

  return html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="theme-color" content="#f5f5f0" />
        <title>SHARE-FILES</title>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <header class="topbar">
          <a href="/" class="brand">SHARE—FILES</a>
          <div class="sub">P2P / 1:1 / WEBRTC</div>
        </header>

        <main class="container">
          <section id="homeView" class="card home ${homeHidden}">
            <div class="homeGrid">
              <div class="homeHero">
                <div class="eyebrow">DIRECT—PRIVATE—INSTANT</div>
                <h1>ファイルを<br />直接送る</h1>
                <p class="lead">
                  サーバにアップロードせず、端末間で直接転送。接続の取り次ぎだけサーバを使います。
                </p>
                <div class="heroChips">
                  <span class="chip">NO SERVER STORAGE</span>
                  <span class="chip">1:1 P2P</span>
                  <span class="chip">WEBRTC</span>
                </div>
                <div class="steps">
                  <div class="step"><span>1</span> ルーム作成</div>
                  <div class="step"><span>2</span> リンク共有</div>
                  <div class="step"><span>3</span> 送信</div>
                </div>
              </div>

              <div class="homePanel">
                <div class="panelBlock">
                  <div class="panelTitle">送信を開始</div>
                  <label class="toggle">
                    <input id="encryptToggle" type="checkbox" checked />
                    <span>E2E暗号化ON</span>
                  </label>
                  <button id="createBtn" class="btn primary">ルーム作成</button>
                </div>

                <hr class="sep" />

                <div class="panelBlock">
                  <div class="panelTitle">受信に参加</div>
                  <div class="row gap wrap">
                    <input id="joinCode" class="input" placeholder="コード入力（例: ABCD...）" />
                    <button id="joinBtn" class="btn">参加</button>
                  </div>
                  <p class="muted small">
                    暗号化ONならリンクに鍵が含まれます。
                  </p>
                </div>
              </div>
            </div>

            <div class="foot muted">
              P2Pのみ。ネットワーク条件によっては接続不可（TURN無し）
            </div>
          </section>

          <section id="roomView" class="card room ${roomHidden}">
            <div class="roomHeader">
              <div class="roomTitle">
                <div class="eyebrow">ROOM—SESSION</div>
                <h2>ROOM <span id="roomIdLabel" class="mono">${activeRoom}</span></h2>
                <div id="status" class="status">初期化中...</div>
              </div>
              <div class="right">
                <button id="copyLinkBtn" class="btn">LINK</button>
                <button id="copyCodeBtn" class="btn">CODE</button>
              </div>
            </div>

            <div class="roomGrid">
              <div class="roomSide">
                <div class="kv">
                  <div class="k">ROLE</div>
                  <div class="v" id="roleLabel">—</div>
                  <div class="k">PEERS</div>
                  <div class="v" id="peersLabel">0</div>
                </div>
                <div class="sideCard muted small">
                  暗号化ONの場合、リンクの「#」以降に復号鍵が含まれます（サーバには送られません）。
                </div>
              </div>

              <div class="roomMain">
                <div id="senderPane" class="pane hidden">
                  <div id="drop" class="drop">
                    <div class="dropTitle">DROP FILE HERE</div>
                    <div class="muted small">または</div>
                    <label class="btn">
                      SELECT
                      <input id="fileInput" type="file" hidden />
                    </label>
                  </div>

                  <div class="row gap wrap">
                    <button id="sendBtn" class="btn primary" disabled>SEND</button>
                    <div class="muted small" id="fileInfo"></div>
                  </div>

                  <div class="progress">
                    <div class="bar"><div id="sendBar" class="fill" style="width: 0%"></div></div>
                    <div class="muted small" id="sendText">0%</div>
                  </div>
                </div>

                <div id="receiverPane" class="pane hidden">
                  <div class="muted">送信側がファイルを選ぶのを待っています...</div>

                  <div class="progress">
                    <div class="bar"><div id="recvBar" class="fill" style="width: 0%"></div></div>
                    <div class="muted small" id="recvText">0%</div>
                  </div>

                  <div id="downloadArea" class="hidden">
                    <a id="downloadLink" class="btn primary" href="#">DOWNLOAD</a>
                    <div class="muted small" id="downloadMeta"></div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>

        <script type="module" src="/app.js"></script>
        <script>
          if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
        </script>
      </body>
    </html>`;
}
