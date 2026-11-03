import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

export interface Budget {
  extension: string;
  limitBytes: number;
}

export interface GroupReport extends Budget {
  fileCount: number;
  gzipBytes: number;
  ok: boolean;
}

// Chosen empirically, no fixed source.
export const BUDGETS: readonly Budget[] = [
  { extension: ".js", limitBytes: 100_000 },
  { extension: ".css", limitBytes: 5_000 },
];

export const checkBundleSize = (
  assetsDir: string,
  budgets: readonly Budget[],
): GroupReport[] => {
  const files = readdirSync(assetsDir, { recursive: true, encoding: "utf8" });

  return budgets.map(({ extension, limitBytes }) => {
    const matching = files.filter((file) => file.endsWith(extension));
    const gzipBytes = matching.reduce(
      (sum, file) => sum + gzipSync(readFileSync(join(assetsDir, file))).length,
      0,
    );

    return {
      extension,
      limitBytes,
      fileCount: matching.length,
      gzipBytes,
      ok: matching.length > 0 && gzipBytes <= limitBytes,
    };
  });
};

export const formatReport = (report: GroupReport): string => {
  const { extension, fileCount, gzipBytes, limitBytes, ok } = report;
  if (fileCount === 0) {
    return `FAIL ${extension}: no ${extension} asset found`;
  }

  return `${ok ? "ok  " : "FAIL"} ${extension}: ${String(gzipBytes)} B gzip across ${String(fileCount)} file(s), limit ${String(limitBytes)} B`;
};
