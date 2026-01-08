/**
 * Layout shell for share-files pages.
 * See README.md for the flow overview; used by TopPage and RoomPage.
 */

import { ViteClient } from "vite-ssr-components/hono";
import type { Translations, Locale } from "../i18n";
import { supportedLocales, getTranslations } from "../i18n";

type LayoutProps = {
  title: string;
  children: any;
  scripts?: any;
  bodyAttrs?: Record<string, string>;
  t: Translations;
  locale: Locale;
};

export function Layout({ title, children, scripts, bodyAttrs = {}, t, locale }: LayoutProps) {
  return (
    <html lang={locale}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="theme-color" content="#f5f5f0" />
        <title>{title}</title>
        <ViteClient />
        <link rel="stylesheet" href="/style.css" />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__LOCALE__=${JSON.stringify(locale)};window.__TRANSLATIONS__=${JSON.stringify(t)};`,
          }}
        />
      </head>
      <body {...bodyAttrs}>
        <header class="topbar">
          <a href="/" class="brand">{t.header.brand}</a>
          <div class="sub">{t.header.sub}</div>
          <div class="langSwitcher">
            {supportedLocales.map((l) => {
              const langT = getTranslations(l);
              const isActive = l === locale;
              const basePath = typeof window !== "undefined" ? window.location.pathname : "";
              return (
                <a
                  href={`?lang=${l}`}
                  class={`langBtn${isActive ? " active" : ""}`}
                  title={langT.langName}
                >
                  {l.toUpperCase()}
                </a>
              );
            })}
          </div>
        </header>

        <main class="container">{children}</main>

        {scripts}
      </body>
    </html>
  );
}
