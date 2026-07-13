import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: __dirname,
  base: "/",
  server: {
    host: true,
    port: 4173,
  },
  build: {
    emptyOutDir: true,
  },
  plugins: [tailwindcss()],
});
