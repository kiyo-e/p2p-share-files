/**
 * Layout shell for share-files pages.
 * See README.md for the flow overview; used by TopPage and RoomPage.
 */

type LayoutProps = {
  title: string;
  scriptSrc: string;
  children: any;
  bodyAttrs?: Record<string, string>;
};

const swScript = "if (\"serviceWorker\" in navigator) navigator.serviceWorker.register(\"/sw.js\");";

export function Layout({ title, scriptSrc, children, bodyAttrs = {} }: LayoutProps) {
  return (
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="theme-color" content="#f5f5f0" />
        <title>{title}</title>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body {...bodyAttrs}>
        <header class="topbar">
          <a href="/" class="brand">SHARE—FILES</a>
          <div class="sub">P2P / 1:1 / WEBRTC</div>
        </header>

        <main class="container">{children}</main>

        <script type="module" src={scriptSrc}></script>
        <script
          dangerouslySetInnerHTML={{
            __html: swScript,
          }}
        />
      </body>
    </html>
  );
}
