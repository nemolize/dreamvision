import type { MockInstance } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RESOLUTION } from "./resolution";
import { DEFAULT_SETTINGS } from "./settings";
import {
  loadResolution,
  loadSettings,
  saveResolution,
  saveSettings,
} from "./settingsStorage";

const STORAGE_KEY = "dreamvision.settings";
const RESOLUTION_KEY = "dreamvision.resolution";

// Restored by hand: `vi.restoreAllMocks` does not reach a spy installed on
// happy-dom's `localStorage` proxy, so one left behind breaks the next test.
const installed: MockInstance[] = [];

const breakStorage = (method: "getItem" | "setItem", reason: string): void => {
  installed.push(
    vi.spyOn(window.localStorage, method).mockImplementation(() => {
      throw new Error(reason);
    }),
  );
};

afterEach(() => {
  for (const spy of installed) spy.mockRestore();
  installed.length = 0;
  window.localStorage.clear();
});

describe("loadSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("reads back what saveSettings wrote", () => {
    const stored = { ...DEFAULT_SETTINGS, splatForce: 55 };
    saveSettings(stored);
    expect(loadSettings()).toEqual(stored);
  });

  it("falls back to the defaults on a corrupt blob", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("normalises an out-of-range stored value rather than trusting it", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ splatForce: 1e6 }),
    );
    expect(loadSettings().splatForce).toBe(100);
  });

  it("survives a getItem that throws, as a private window's does", () => {
    breakStorage("getItem", "SecurityError");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("saveSettings", () => {
  it("survives a setItem that throws, leaving the session usable", () => {
    breakStorage("setItem", "QuotaExceededError");
    expect(() => {
      saveSettings(DEFAULT_SETTINGS);
    }).not.toThrow();
  });
});

describe("loadResolution", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadResolution()).toEqual(DEFAULT_RESOLUTION);
  });

  it("reads back what saveResolution wrote", () => {
    const stored = { ...DEFAULT_RESOLUTION, simResolution: 128 };
    saveResolution(stored);
    expect(loadResolution()).toEqual(stored);
  });

  it("falls back to the defaults on a corrupt blob", () => {
    window.localStorage.setItem(RESOLUTION_KEY, "{not json");
    expect(loadResolution()).toEqual(DEFAULT_RESOLUTION);
  });

  it("normalises an out-of-range stored value rather than trusting it", () => {
    window.localStorage.setItem(
      RESOLUTION_KEY,
      JSON.stringify({ dyeResolution: 1e6 }),
    );
    expect(loadResolution().dyeResolution).toBe(2048);
  });

  it("survives a getItem that throws, as a private window's does", () => {
    breakStorage("getItem", "SecurityError");
    expect(loadResolution()).toEqual(DEFAULT_RESOLUTION);
  });
});

describe("saveResolution", () => {
  it("leaves the settings blob alone, so the two channels cannot clobber", () => {
    saveSettings(DEFAULT_SETTINGS);
    saveResolution({ ...DEFAULT_RESOLUTION, simResolution: 128 });

    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadResolution().simResolution).toBe(128);
  });

  it("survives a setItem that throws, leaving the session usable", () => {
    breakStorage("setItem", "QuotaExceededError");
    expect(() => {
      saveResolution(DEFAULT_RESOLUTION);
    }).not.toThrow();
  });
});
