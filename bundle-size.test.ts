import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BUDGETS, checkBundleSize, formatReport } from "./bundle-size";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bundle-size-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const gzipLength = (content: string) => gzipSync(content).length;

describe("checkBundleSize", () => {
  it("passes when every group is within its limit", () => {
    writeFileSync(join(dir, "a.js"), "console.log(1);");
    writeFileSync(join(dir, "a.css"), "body{}");

    const reports = checkBundleSize(dir, BUDGETS);

    expect(reports.map((report) => report.ok)).toEqual([true, true]);
  });

  it("sums the gzip size of every file in a group, subdirectories included", () => {
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "a.js"), "aaaa");
    writeFileSync(join(dir, "nested", "b.js"), "bbbbbbbb");

    const [report] = checkBundleSize(dir, [
      { extension: ".js", limitBytes: 1e6 },
    ]);

    expect(report).toMatchObject({
      fileCount: 2,
      gzipBytes: gzipLength("aaaa") + gzipLength("bbbbbbbb"),
    });
  });

  it("measures gzip size, not raw size", () => {
    const content = "x".repeat(10_000);
    writeFileSync(join(dir, "a.js"), content);

    const [report] = checkBundleSize(dir, [
      { extension: ".js", limitBytes: 1000 },
    ]);

    expect(report?.gzipBytes).toBe(gzipLength(content));
    expect(report?.ok).toBe(true);
  });

  it("fails a group whose gzip total is one byte over its limit", () => {
    writeFileSync(join(dir, "a.js"), "console.log(1);");
    const size = gzipLength("console.log(1);");

    const [atLimit] = checkBundleSize(dir, [
      { extension: ".js", limitBytes: size },
    ]);
    const [overLimit] = checkBundleSize(dir, [
      { extension: ".js", limitBytes: size - 1 },
    ]);

    expect(atLimit?.ok).toBe(true);
    expect(overLimit?.ok).toBe(false);
  });

  it("fails a group with no matching file", () => {
    writeFileSync(join(dir, "a.js"), "console.log(1);");

    const reports = checkBundleSize(dir, BUDGETS);

    expect(reports.map((report) => report.ok)).toEqual([true, false]);
    expect(reports[1]).toMatchObject({ extension: ".css", fileCount: 0 });
  });

  it("fails every group when the directory is empty", () => {
    const reports = checkBundleSize(dir, BUDGETS);

    expect(reports.map((report) => report.ok)).toEqual([false, false]);
  });

  it("throws when the directory is missing", () => {
    expect(() => checkBundleSize(join(dir, "missing"), BUDGETS)).toThrow(
      /ENOENT/,
    );
  });
});

describe("formatReport", () => {
  it("names the group, measured size and limit when over budget", () => {
    expect(
      formatReport({
        extension: ".js",
        limitBytes: 100,
        fileCount: 2,
        gzipBytes: 150,
        ok: false,
      }),
    ).toBe("FAIL .js: 150 B gzip across 2 file(s), limit 100 B");
  });

  it("marks a group within budget as ok", () => {
    expect(
      formatReport({
        extension: ".css",
        limitBytes: 100,
        fileCount: 1,
        gzipBytes: 50,
        ok: true,
      }),
    ).toBe("ok   .css: 50 B gzip across 1 file(s), limit 100 B");
  });

  it("says no asset was found for an empty group", () => {
    expect(
      formatReport({
        extension: ".css",
        limitBytes: 100,
        fileCount: 0,
        gzipBytes: 0,
        ok: false,
      }),
    ).toBe("FAIL .css: no .css asset found");
  });
});
