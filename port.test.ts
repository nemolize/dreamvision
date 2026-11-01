import { describe, expect, it } from "vitest";

import { readPort } from "./port";

describe("readPort", () => {
  it.each([undefined, ""])("falls back to the default for %j", (raw) => {
    expect(readPort(raw, "PLAYWRIGHT_PORT")).toBe(5173);
  });

  it.each([
    ["5187", 5187],
    ["1", 1],
    ["65535", 65535],
  ])("accepts port %s", (raw, expected) => {
    expect(readPort(raw, "PLAYWRIGHT_PORT")).toBe(expected);
  });

  it.each(["0", "65536"])("rejects out-of-range port %s", (raw) => {
    expect(() => readPort(raw, "PLAYWRIGHT_PORT")).toThrow(/from 1 to 65535/);
  });

  it.each(["abc", "1e3", "0x143d", " 5173", "5173.0", "-1"])(
    "rejects non-digit input %j",
    (raw) => {
      expect(() => readPort(raw, "PLAYWRIGHT_PORT")).toThrow(
        /must be an integer/,
      );
    },
  );

  it.each(["PLAYWRIGHT_PORT", "E2E_PORT"])(
    "names %s in the error",
    (variable) => {
      expect(() => readPort("abc", variable)).toThrow(
        new RegExp(`^${variable} must be an integer`),
      );
    },
  );
});
