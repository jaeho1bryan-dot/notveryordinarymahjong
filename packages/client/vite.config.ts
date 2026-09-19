import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The engine is consumed straight from source so no build ordering is needed.
      "@mahjong/shared": resolvePath("../shared/src/index.ts"),
      // `riichi` pulls in node's `assert`; the browser gets a tiny stand-in.
      assert: resolvePath("./src/shims/assert.ts"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
