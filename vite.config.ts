import { defineConfig } from "vite";
import build from "@hono/vite-build/cloudflare-workers";
import devServer from "@hono/vite-dev-server";
import adapter from "@hono/vite-dev-server/cloudflare";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ command }) => {
  if (command === "serve") {
    return {
      plugins: [
        devServer({
          entry: "src/index.ts",
          adapter,
        }),
      ],
      publicDir: "public",
    };
  }

  return {
    plugins: [
      cloudflare(),
      build({
        entry: "src/index.ts",
        minify: true,
      }),
    ],
    publicDir: "public",
    build: {
      emptyOutDir: true,
    },
  };
});
