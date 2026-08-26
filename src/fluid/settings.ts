import {
  DYE_DISSIPATION,
  PRESSURE_ITERATIONS,
  SPLAT_FORCE,
  SPLAT_RADIUS,
  VELOCITY_DISSIPATION,
} from "./config";

/** Only constants that take effect on the next frame: anything that resizes a
 * grid or rebuilds a pipeline would make the panel a restart, not a control. */
export interface FluidSettings {
  velocityDissipation: number;
  dyeDissipation: number;
  splatRadius: number;
  splatForce: number;
  pressureIterations: number;
}

export const DEFAULT_SETTINGS: FluidSettings = {
  velocityDissipation: VELOCITY_DISSIPATION,
  dyeDissipation: DYE_DISSIPATION,
  splatRadius: SPLAT_RADIUS,
  splatForce: SPLAT_FORCE,
  pressureIterations: PRESSURE_ITERATIONS,
};

export interface SettingDescriptor {
  key: keyof FluidSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Decimals shown beside the slider; the step's precision, not the value's. */
  precision: number;
}

export const SETTING_DESCRIPTORS: readonly SettingDescriptor[] = [
  {
    key: "velocityDissipation",
    label: "Velocity decay",
    min: 0,
    max: 2,
    step: 0.01,
    precision: 2,
  },
  {
    key: "dyeDissipation",
    label: "Dye decay",
    min: 0,
    max: 3,
    step: 0.01,
    precision: 2,
  },
  {
    key: "splatRadius",
    label: "Splat size",
    min: 0.0005,
    max: 0.02,
    step: 0.0005,
    precision: 4,
  },
  {
    key: "splatForce",
    label: "Splat force",
    min: 1,
    max: 100,
    step: 1,
    precision: 0,
  },
  {
    key: "pressureIterations",
    label: "Pressure sweeps",
    min: 1,
    max: 64,
    step: 1,
    precision: 0,
  },
];

const DESCRIPTORS_BY_KEY = new Map(
  SETTING_DESCRIPTORS.map((descriptor) => [descriptor.key, descriptor]),
);

/** A stored setting outlives the range that produced it, so a value read back
 * is untrusted input rather than one this build wrote. */
export const clampSetting = (
  key: keyof FluidSettings,
  value: number,
): number => {
  const descriptor = DESCRIPTORS_BY_KEY.get(key);
  if (descriptor === undefined || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS[key];
  }
  const bounded = Math.min(descriptor.max, Math.max(descriptor.min, value));
  // Integer-step settings index a loop or a count, so a consumer receiving a
  // fractional one would have to re-guard what the descriptor already declares.
  return Number.isInteger(descriptor.step) ? Math.round(bounded) : bounded;
};

/** Falls back per key rather than wholesale, so a blob predating a key this
 * build added still yields every slider a value. */
export const normaliseSettings = (input: unknown): FluidSettings => {
  if (typeof input !== "object" || input === null) return DEFAULT_SETTINGS;
  const entries = new Map<string, unknown>(Object.entries(input));
  const result = { ...DEFAULT_SETTINGS };
  for (const { key } of SETTING_DESCRIPTORS) {
    const value = entries.get(key);
    if (typeof value === "number") result[key] = clampSetting(key, value);
  }
  return result;
};
