import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const host = process.env["VITE_HOST"];
const port = Number(process.env["VITE_PORT"] ?? 5173);
const apiProxyTarget = process.env["VITE_API_PROXY_TARGET"] ?? "http://localhost:3100";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port,
    ...(host ? { host } : {}),
    proxy: {
      "/api": apiProxyTarget,
    },
  },
});
