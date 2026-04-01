import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiOrigin = process.env.COBOOK_API_ORIGIN ?? "http://127.0.0.1:4310";
const webHost = process.env.COBOOK_WEB_HOST ?? "127.0.0.1";
const webPort = Number.parseInt(process.env.COBOOK_WEB_PORT ?? "5173", 10);

export default defineConfig({
  plugins: [react()],
  server: {
    host: webHost,
    port: Number.isNaN(webPort) ? 5173 : webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiOrigin,
        changeOrigin: true
      }
    }
  },
  preview: {
    host: webHost,
    port: Number.isNaN(webPort) ? 5173 : webPort,
    strictPort: true
  }
});
