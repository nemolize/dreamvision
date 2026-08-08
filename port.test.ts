import { describe, expect, it } from "vitest";

import { readPort } from "./port";

describe("readPort", () => {
  it("falls back to the default when unset or empty", () => {
    expect(readPort(undefined)).toBe(5173);
    expect(readPort("")).toBe(5173);
  });

  it("accepts a port in range", () => {
    expect(readPort("5187")).toBe(5187);
    expect(readPort("1")).toBe(1);
    expect(readPort("65535")).toBe(65535);
  });

  it("rejects a value outside the valid range", () => {
    expect(() => readPort("0")).toThrow(/from 1 to 65535/);
    expect(() => readPort("65536")).toThrow(/from 1 to 65535/);
  });

  it("rejects anything that is not plain digits", () => {
    for (const raw of ["abc", "1e3", "0x143d", " 5173", "5173.0", "-1"]) {
      expect(() => readPort(raw)).toThrow(/must be an integer/);
    }
  });
});
