import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { experimental_readRawConfig, unstable_readConfig } from "wrangler";

const productionRoutes = [
  { pattern: "app.example.com", custom_domain: true },
  { pattern: "example.com/*", zone_name: "example.com" },
];
const productionTriggers = { crons: ["0 * * * *"] };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wrangler-preview-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// wrangler re-exports its raw-config reader from @cloudflare/workers-utils,
// which it does not ship, so the reader's type is unresolvable without this.
function isRawConfigReader(
  value: unknown,
): value is (args: { config: string }) => { rawConfig: unknown } {
  return typeof value === "function";
}

// wrangler's own reader, so the JSONC wrangler deploys from (comments,
// trailing commas) parses here, and whatever wrangler rejects throws.
function readConfig(path: string): object {
  if (!isRawConfigReader(experimental_readRawConfig)) {
    throw new Error("wrangler no longer exports experimental_readRawConfig");
  }
  const { rawConfig } = experimental_readRawConfig({ config: path });
  if (typeof rawConfig !== "object" || rawConfig === null) {
    throw new Error(`${path} is not a JSON object`);
  }
  return rawConfig;
}

// wrangler's published types reference @cloudflare/workers-utils, which the
// package does not ship, so the resolved config is only checkable as unknown.
function resolvePreview(raw: object): unknown {
  const path = join(dir, "wrangler.json");
  writeFileSync(path, JSON.stringify(raw));
  return unstable_readConfig(
    { config: path, env: "preview" },
    { hideWarnings: true },
  );
}

describe("wrangler.json env.preview", () => {
  // A singular `route` is still inherited; it stays off the preview Worker only
  // because deploy applies `routes ?? [route]`, which this test does not run.
  it.each([
    ["routes", { routes: productionRoutes, route: undefined }],
    ["route", { route: "example.com/*", routes: undefined }],
  ])(
    "resolves empty routes and crons for preview despite a top-level %s",
    (_, topLevel) => {
      const resolved = resolvePreview({
        ...readConfig("wrangler.json"),
        ...topLevel,
        triggers: productionTriggers,
      });

      expect(resolved).toMatchObject({ routes: [], triggers: { crons: [] } });
    },
  );

  it("would inherit them without the override", () => {
    const resolved = resolvePreview({
      ...readConfig("wrangler.json"),
      routes: productionRoutes,
      route: undefined,
      triggers: productionTriggers,
      env: { preview: {} },
    });

    expect(resolved).toMatchObject({
      routes: productionRoutes,
      triggers: productionTriggers,
    });
  });
});

describe("readConfig", () => {
  it("accepts the comments and trailing commas wrangler accepts", () => {
    const path = join(dir, "wrangler.json");
    writeFileSync(path, '{\n  // comment\n  "name": "x", /* block */\n}\n');

    expect(readConfig(path)).toEqual({ name: "x" });
  });

  it("throws on a config wrangler rejects", () => {
    const path = join(dir, "wrangler.json");
    writeFileSync(path, '{ "name": "x" "main": "a.ts" }');

    expect(() => readConfig(path)).toThrow("CommaExpected");
  });
});
