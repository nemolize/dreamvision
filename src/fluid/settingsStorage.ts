import type { FluidSettings } from "./settings";
import { DEFAULT_SETTINGS, normaliseSettings } from "./settings";

const STORAGE_KEY = "dreamvision.settings";

/** Guarded because `localStorage` throws on the access itself in a private
 * window or with site data blocked, not merely returning null. */
export const loadSettings = (): FluidSettings => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return DEFAULT_SETTINGS;
    return normaliseSettings(JSON.parse(stored));
  } catch {
    return DEFAULT_SETTINGS;
  }
};

/** Swallowed because a full or blocked store costs the user persistence, not
 * the session — the settings they just moved still drive this frame. */
export const saveSettings = (settings: FluidSettings): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    return;
  }
};
