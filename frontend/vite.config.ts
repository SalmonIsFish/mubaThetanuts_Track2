import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Deployed at amanahtrader.uk/thetanuts/ -- assets must resolve under
  // /thetanuts/ and API calls under /thetanuts/api. Overridable via
  // VITE_BASE (e.g. "/" for local root serve) at build time.
  base: process.env.VITE_BASE ?? "/thetanuts/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8790",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/thetanuts/api": {
        target: "http://127.0.0.1:8790",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/thetanuts\/api/, ""),
      },
    },
  },
});
