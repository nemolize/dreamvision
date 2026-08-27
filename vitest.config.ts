import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.{test,spec}.{js,ts,tsx}", "*.{test,spec}.{js,ts}"],
    exclude: ["e2e-tests/**/*", "node_modules/**/*"],
    coverage: {
      provider: "v8",
      // json + json-summary feed the coverage report action in CI.
      reporter: ["text", "html", "json", "json-summary"],
      reportOnFailure: true,
      include: ["src/**/*.{ts,tsx}", "port.ts"],
      // Everything touching WebGPU needs a real adapter, which Node has no
      // implementation of; the Playwright suite covers those instead.
      exclude: [
        "src/**/*.{test,spec}.*",
        "src/**/*.d.ts",
        "src/main.tsx",
        "src/App.tsx",
        "src/FluidCanvas.tsx",
        "src/fluid/gpu.ts",
        "src/fluid/resample.ts",
        "src/fluid/renderer.ts",
        "src/fluid/types.ts",
      ],
      thresholds: {
        autoUpdate: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
