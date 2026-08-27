import {
  DYE_DISSIPATION,
  PRESSURE_ITERATIONS,
  SPLAT_FORCE,
  SPLAT_RADIUS,
  VELOCITY_DISSIPATION,
} from "./config";
import type { SettingDescriptor } from "./descriptor";
import { describeSettings } from "./descriptor";

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

export const SETTING_DESCRIPTORS: readonly SettingDescriptor<
  keyof FluidSettings
>[] = [
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

const settings = describeSettings(SETTING_DESCRIPTORS, DEFAULT_SETTINGS);

export const clampSetting = settings.clamp;

export const normaliseSettings = (input: unknown): FluidSettings =>
  settings.normalise(input);
