/**
 * Layout shell for share-files pages.
 * See README.md for the flow overview; used by TopPage and RoomPage.
 */

type LayoutProps = {
  title: string;
  scripts: string[];
  children: any;
  bodyAttrs?: Record<string, string>;
};

export function Layout({ title, scripts, children, bodyAttrs = {} }: LayoutProps) {
  return (
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="theme-color" content="#f5f5f0" />
        <title>{title}</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body {...bodyAttrs}>
        <header class="topbar">
          <a href="/" class="brand">SHARE—FILES</a>
          <div class="sub">P2P / 1:1 / WEBRTC</div>
        </header>

        <main class="container">{children}</main>

        {scripts.map((src) => (
          <script type="module" src={src}></script>
        ))}
      </body>
    </html>
  );
}
