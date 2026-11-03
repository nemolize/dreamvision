import { describe, expect, it } from "vitest";

import {
  clampSetting,
  DEFAULT_SETTINGS,
  normaliseSettings,
  SETTING_DESCRIPTORS,
} from "./settings";

describe("clampSetting", () => {
  it("holds a value inside the descriptor's range", () => {
    expect(clampSetting("splatForce", 42)).toBe(42);
  });

  it("clamps to each end of the range", () => {
    expect(clampSetting("splatForce", 1e6)).toBe(100);
    expect(clampSetting("splatForce", -5)).toBe(1);
  });

  it("snaps a setting whose step is an integer", () => {
    expect(clampSetting("pressureIterations", 3.7)).toBe(4);
    expect(clampSetting("splatForce", 29.4)).toBe(29);
  });

  it("leaves a fractional-step setting unsnapped", () => {
    expect(clampSetting("splatRadius", 0.0037)).toBeCloseTo(0.0037, 6);
    expect(clampSetting("dyeDissipation", 0.65)).toBeCloseTo(0.65, 6);
  });

  it("falls back to the default for a non-finite value", () => {
    expect(clampSetting("dyeDissipation", Number.NaN)).toBe(
      DEFAULT_SETTINGS.dyeDissipation,
    );
    expect(clampSetting("dyeDissipation", Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_SETTINGS.dyeDissipation,
    );
  });
});

describe("normaliseSettings", () => {
  it("returns the defaults for input that is not an object", () => {
    expect(normaliseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normaliseSettings("velocityDissipation=1")).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it("keeps supplied keys and defaults the rest", () => {
    const result = normaliseSettings({ splatForce: 50 });
    expect(result.splatForce).toBe(50);
    expect(result.dyeDissipation).toBe(DEFAULT_SETTINGS.dyeDissipation);
  });

  it("yields an integer sweep count, which the renderer loops on directly", () => {
    expect(normaliseSettings({ pressureIterations: 3.7 })).toMatchObject({
      pressureIterations: 4,
    });
    expect(Number.isInteger(DEFAULT_SETTINGS.pressureIterations)).toBe(true);
  });

  it("lets the vorticity strength reach zero, which switches the pass off", () => {
    expect(clampSetting("vorticityConfinement", 0)).toBe(0);
    expect(clampSetting("vorticityConfinement", -3)).toBe(0);
    expect(clampSetting("vorticityConfinement", 1e6)).toBe(100);
  });

  it("clamps an out-of-range stored value", () => {
    expect(normaliseSettings({ pressureIterations: 1000 })).toMatchObject({
      pressureIterations: 64,
    });
  });

  it("ignores a key whose stored value is not a number", () => {
    expect(normaliseSettings({ splatForce: "50" })).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips every default unchanged", () => {
    expect(normaliseSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("SETTING_DESCRIPTORS", () => {
  it("gives every setting a descriptor whose range holds its default", () => {
    const described = SETTING_DESCRIPTORS.map((descriptor) => descriptor.key);
    const { wrapEdges: _toggle, ...numeric } = DEFAULT_SETTINGS;
    expect([...described].sort()).toEqual(Object.keys(numeric).sort());

    for (const { key, min, max } of SETTING_DESCRIPTORS) {
      expect(DEFAULT_SETTINGS[key]).toBeGreaterThanOrEqual(min);
      expect(DEFAULT_SETTINGS[key]).toBeLessThanOrEqual(max);
    }
  });
});

describe("wrapEdges", () => {
  it("defaults to walls", () => {
    expect(DEFAULT_SETTINGS.wrapEdges).toBe(false);
    expect(normaliseSettings({}).wrapEdges).toBe(false);
  });

  it("keeps a stored boolean", () => {
    expect(normaliseSettings({ wrapEdges: true }).wrapEdges).toBe(true);
    expect(normaliseSettings({ wrapEdges: false }).wrapEdges).toBe(false);
  });

  it("falls back to the default for a stored value that is not a boolean", () => {
    expect(normaliseSettings({ wrapEdges: 1 }).wrapEdges).toBe(false);
    expect(normaliseSettings({ wrapEdges: "true" }).wrapEdges).toBe(false);
  });
});
