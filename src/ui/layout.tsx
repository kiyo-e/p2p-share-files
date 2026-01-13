/**
 * Layout shell for Pairlane pages.
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
  url?: string;
};

export function Layout({ title, children, scripts, bodyAttrs = {}, t, locale, url }: LayoutProps) {
  const baseUrl = url ? new URL(url).origin : "";
  const pageUrl = url || baseUrl;
  const ogImage = `${baseUrl}/og-image.png`;

  return (
    <html lang={locale}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="theme-color" content="#f5f5f0" />
        <meta name="description" content={t.description} />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={t.description} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:site_name" content="PAIRLANE" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={t.description} />
        <meta name="twitter:image" content={ogImage} />

        {/* Favicon */}
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />

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
              return (
                <a
                  href={`?lang=${l}`}
                  class={`langBtn${isActive ? " active" : ""}`}
                  title={langT.langName}
                  onClick={`event.preventDefault();location.href='?lang=${l}'+location.hash;`}
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
