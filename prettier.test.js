import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const prettier = require.resolve("prettier/bin/prettier.cjs");
let fixture;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "prettier-store-probe-"));
  copyFileSync(
    new URL(".prettierignore", import.meta.url),
    join(fixture, ".prettierignore"),
  );
  writeFileSync(join(fixture, "_tmp_1234_12345678"), "");
  writeFileSync(
    join(fixture, "race.mjs"),
    `import fs from "node:fs/promises";
import { basename } from "node:path";
const readFile = fs.readFile;
fs.readFile = async function (file, ...args) {
  if (basename(String(file)).startsWith("_tmp_")) {
    await fs.unlink(file);
  }
  return readFile.call(this, file, ...args);
};
`,
  );
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function check(source) {
  writeFileSync(join(fixture, "source.js"), source);
  return spawnSync(
    process.execPath,
    [
      "--import",
      join(fixture, "race.mjs"),
      prettier,
      "--check",
      ".",
      "--no-config",
    ],
    { cwd: fixture, encoding: "utf8", timeout: 10_000 },
  );
}

describe("Prettier during parallel pnpm scripts", () => {
  it("ignores store probes that disappear before they can be read", () => {
    const result = check("const answer = 42;\n");

    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("still rejects formatting errors in source files", () => {
    const result = check("const answer=42\n");

    expect(result.error).toBeUndefined();
    expect(result.stderr).toContain("source.js");
    expect(result.status).toBe(1);
  });
});
