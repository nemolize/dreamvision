import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e-tests/**"],
    projects: [
      {
        test: {
          name: "dom",
          environment: "happy-dom",
          setupFiles: ["./src/test-setup.ts"],
          include: ["src/**/*.{test,spec}.{js,ts,tsx}"],
        },
      },
      {
        test: {
          name: "node",
          include: ["*.{test,spec}.{js,ts}"],
        },
      },
    ],
    coverage: {
      // json + json-summary feed the coverage report action in CI.
      reporter: ["text", "html", "json", "json-summary"],
      reportOnFailure: true,
      include: ["src/**/*.{ts,tsx}", "port.ts"],
      // Modules that issue GPU commands need a real adapter, which Node has no
      // implementation of; the Playwright suite covers those instead.
      exclude: [
        "src/**/*.{test,spec}.*",
        "src/**/*.d.ts",
        "src/test-setup.ts",
        "src/main.tsx",
        "src/App.tsx",
        "src/fluid/doubleBuffer.ts",
        "src/fluid/frame.ts",
        "src/fluid/gpu.ts",
        "src/fluid/pipelines.ts",
        "src/fluid/resample.ts",
        "src/fluid/renderer.ts",
        "src/fluid/resources.ts",
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
    tsconfigPaths: true,
  },
});
