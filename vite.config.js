import { defineConfig } from "vite";

export default defineConfig({
   base: "./",
    build: { outDir: "dist" },
  server: {
    host: true,
    port: 5173
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 0
  }
});
