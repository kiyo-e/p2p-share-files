import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "public/assets",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        home: "src/client/home.tsx",
        room: "src/client/room.tsx",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
