import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "public/assets",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        home: "src/client/home.ts",
        room: "src/client/room.ts",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
