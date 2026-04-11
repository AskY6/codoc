import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite dev server runs on :5173. The Hono backend runs on :3100.
// Same-origin is preserved by proxying /api → :3100; this avoids
// CORS in development entirely. Production wiring decides its own
// origin policy when it lands.

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
    },
  },
});
