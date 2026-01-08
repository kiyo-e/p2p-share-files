import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ command }) => ({
  plugins: [
    cloudflare({
      config: () => {
        if (command !== "serve") return {};
        return {
          assets: {
            directory: "./public",
          },
        };
      },
    }),
  ],
  publicDir: "public",
  build: {
    outDir: "dist-worker",
    emptyOutDir: true,
  },
}));
