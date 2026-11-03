import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cli = join(import.meta.dirname, "check-bundle-size.ts");

let cwd = "";
let assets = "";

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "check-bundle-size-"));
  assets = join(cwd, "dist", "assets");
  mkdirSync(assets, { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const run = () => spawnSync(process.execPath, [cli], { cwd, encoding: "utf8" });

describe("check-bundle-size", () => {
  it("exits 0 when every group is within budget", () => {
    writeFileSync(join(assets, "a.js"), "console.log(1);");
    writeFileSync(join(assets, "a.css"), "body{}");

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ok   .js");
  });

  it("exits 1 and names the group when a bundle is over budget", () => {
    writeFileSync(join(assets, "a.js"), randomBytes(150_000));
    writeFileSync(join(assets, "a.css"), "body{}");

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/FAIL \.js: \d+ B gzip.*limit 100000 B/);
  });

  it("exits 1 when a group has no asset", () => {
    writeFileSync(join(assets, "a.js"), "console.log(1);");

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL .css: no .css asset found");
  });

  it("exits non-zero when dist/assets is missing", () => {
    rmSync(join(cwd, "dist"), { recursive: true });

    expect(run().status).not.toBe(0);
  });
});
