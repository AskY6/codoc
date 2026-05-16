import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@plugins": resolve(__dirname, "..", "plugins"),
    },
  },
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    fs: {
      // Permit serving plugin UI bundles that live outside ui/ root.
      allow: [resolve(__dirname, "..")],
    },
    proxy: {
      "/api": {
        target: "http://localhost:4321",
        changeOrigin: true,
      },
    },
  },
});
