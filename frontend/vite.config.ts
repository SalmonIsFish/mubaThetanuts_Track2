import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // VPS serves at https://amanahtrader.uk/thetanuts/ (subpath, not subdomain).
  // Local dev keeps "/" unchanged; production build sets VITE_BASE_PATH=/thetanuts/
  // so asset URLs in dist/index.html become /thetanuts/assets/...
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8790",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
