import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  root: __dirname,
  base: "/",
  server: {
    host: true,
  },
  build: {
    // outDir (dist/apps/client-pwa) is outside the project root, so Vite
    // does not empty it by default: stale hashed chunks from previous
    // builds would otherwise pile up and get precached by the service
    // worker (generateSW globs the whole outDir).
    emptyOutDir: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png"],
      manifest: {
        name: "Glide",
        short_name: "Glide",
        description: "Remote PC control from iOS",
        theme_color: "#0E0F12",
        background_color: "#0E0F12",
        display: "standalone",
        orientation: "portrait",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
});
