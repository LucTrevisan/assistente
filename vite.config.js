import { defineConfig } from "vite";

export default defineConfig({
  base: "./assistente/",  // ← MUDA: era "./d800/", agora é "./assistente/"
  server: {
    host: true,
    port: 5173
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 0
  }
});