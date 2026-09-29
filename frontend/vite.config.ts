import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served behind Caddy at /stitch/* (see README §3, §7.4). Caddy's
// `uri strip_prefix /stitch` (§7.4) strips the prefix BEFORE forwarding
// to this container, so nginx/vite always sees root-relative paths —
// base stays "/", not "/stitch/".
export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    port: 5173,
    proxy: {
      "/stitch/api": {
        target: "http://localhost:8001",
        rewrite: (path) => path.replace(/^\/stitch\/api/, ""),
      },
    },
  },
  preview: {
    port: 4173,
  },
});
