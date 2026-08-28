import type { ResolutionSettings } from "./resolution";
import { normaliseResolution } from "./resolution";
import type { FluidSettings } from "./settings";
import { normaliseSettings } from "./settings";

const SETTINGS_KEY = "dreamvision.settings";
const RESOLUTION_KEY = "dreamvision.resolution";

/** Guarded because `localStorage` throws on the access itself in a private
 * window or with site data blocked, not merely returning null. */
const read = (key: string): unknown => {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? null : JSON.parse(stored);
  } catch {
    return null;
  }
};

/** Swallowed because a full or blocked store costs the user persistence, not
 * the session — the settings they just moved still drive this frame. */
const write = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
};

export const loadSettings = (): FluidSettings =>
  normaliseSettings(read(SETTINGS_KEY));

export const saveSettings = (settings: FluidSettings): void => {
  write(SETTINGS_KEY, settings);
};

// Its own key, not a field on the settings blob, so a blob written before this
// build still loads without its missing resolution keys reading as a change.
export const loadResolution = (): ResolutionSettings =>
  normaliseResolution(read(RESOLUTION_KEY));

export const saveResolution = (resolution: ResolutionSettings): void => {
  write(RESOLUTION_KEY, resolution);
};
