import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "./settings";
import { loadSettings, saveSettings } from "./settingsStorage";

const STORAGE_KEY = "dreamvision.settings";

afterEach(() => {
  vi.restoreAllMocks();
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
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("saveSettings", () => {
  it("survives a setItem that throws, leaving the session usable", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => {
      saveSettings(DEFAULT_SETTINGS);
    }).not.toThrow();
  });
});
