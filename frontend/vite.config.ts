import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: {
      // REST calls to the FastAPI backend during dev.
      "/api": {
        target: "http://localhost:8002",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      // The live voice session WebSocket — ws:true is required for upgrade
      // requests to be proxied (first WS usage in this portfolio).
      "/ws": {
        target: "ws://localhost:8002",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
