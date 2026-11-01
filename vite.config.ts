import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { localServerPort } from "./port.ts";

export default defineConfig({
  plugins: [react(), cloudflare()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: localServerPort,
    strictPort: true,
  },
  preview: {
    port: localServerPort,
    strictPort: true,
  },
});
