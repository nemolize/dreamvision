import { describe, expect, it } from "vitest";

import {
  clampSetting,
  DEFAULT_SETTINGS,
  liftStrength,
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
    expect(clampSetting("vorticityConfinement", 1e6)).toBe(50);
  });

  it("lets the buoyancy strength reach zero, which switches the pass off", () => {
    expect(clampSetting("buoyancy", 0)).toBe(0);
    expect(clampSetting("buoyancy", -3)).toBe(0);
    expect(clampSetting("buoyancy", 1e6)).toBe(1000);
  });

  it("lets gravity reach zero, which switches the lift off", () => {
    expect(clampSetting("gravity", 0)).toBe(0);
    expect(clampSetting("gravity", -3)).toBe(0);
    expect(clampSetting("gravity", 1e6)).toBe(30);
  });

  it("defaults gravity to Earth's surface value, also for a blob that predates it", () => {
    expect(DEFAULT_SETTINGS.gravity).toBe(9.8);
    expect(normaliseSettings({ buoyancy: 40 }).gravity).toBe(9.8);
    expect(normaliseSettings({ gravity: "x" }).gravity).toBe(9.8);
    expect(normaliseSettings({ gravity: 3 }).gravity).toBe(3);
  });

  it("keeps the cooling rate above zero, so heat always decays", () => {
    expect(clampSetting("heatCooling", 0)).toBeGreaterThan(0);
    expect(clampSetting("heatCooling", -1)).toBeGreaterThan(0);
  });

  it("keeps a stored buoyancy and cooling rate, and defaults a blob that predates them", () => {
    expect(normaliseSettings({ buoyancy: 40, heatCooling: 2 })).toMatchObject({
      buoyancy: 40,
      heatCooling: 2,
    });
    expect(normaliseSettings({ splatForce: 50 })).toMatchObject({
      buoyancy: DEFAULT_SETTINGS.buoyancy,
      heatCooling: DEFAULT_SETTINGS.heatCooling,
    });
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
    const {
      wrapEdges: _wrap,
      showStats: _stats,
      ...numeric
    } = DEFAULT_SETTINGS;
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

describe("liftStrength", () => {
  it("is the buoyancy setting alone at Earth's gravity", () => {
    expect(liftStrength({ buoyancy: 10, gravity: 9.8 })).toBeCloseTo(10, 10);
    expect(
      liftStrength({
        buoyancy: DEFAULT_SETTINGS.buoyancy,
        gravity: DEFAULT_SETTINGS.gravity,
      }),
    ).toBeCloseTo(DEFAULT_SETTINGS.buoyancy, 10);
  });

  it("scales with gravity and with buoyancy", () => {
    expect(liftStrength({ buoyancy: 10, gravity: 19.6 })).toBeCloseTo(20, 10);
    expect(liftStrength({ buoyancy: 500, gravity: 9.8 })).toBeCloseTo(500, 10);
  });

  it("is zero when either factor is zero, which skips the pass", () => {
    expect(liftStrength({ buoyancy: 0, gravity: 9.8 })).toBe(0);
    expect(liftStrength({ buoyancy: 10, gravity: 0 })).toBe(0);
  });
});

describe("showStats", () => {
  it("defaults to hidden", () => {
    expect(DEFAULT_SETTINGS.showStats).toBe(false);
    expect(normaliseSettings({}).showStats).toBe(false);
  });

  it("keeps a stored boolean, and defaults a blob that predates it", () => {
    expect(normaliseSettings({ showStats: true }).showStats).toBe(true);
    expect(normaliseSettings({ wrapEdges: true }).showStats).toBe(false);
  });

  it("falls back to hidden for a stored value that is not a boolean", () => {
    expect(normaliseSettings({ showStats: "yes" }).showStats).toBe(false);
    expect(normaliseSettings({ showStats: 1 }).showStats).toBe(false);
  });
});
