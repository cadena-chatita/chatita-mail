import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

const sha = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "dev"; } })();
const BUILD_ID = `${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${sha}`;

// Chatita Mail frontend. Served at /mail/ in production (nginx), root in dev.
export default defineConfig({
  base: "/mail/",
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
