import {
  BUOYANCY_STRENGTH,
  DYE_DISSIPATION,
  HEAT_COOLING,
  PRESSURE_ITERATIONS,
  SPLAT_FORCE,
  SPLAT_RADIUS,
  VELOCITY_DISSIPATION,
  VORTICITY_CONFINEMENT,
} from "./config";
import type { SettingDescriptor } from "./descriptor";
import { describeSettings } from "./descriptor";

/** Only constants that take effect on the next frame. Grid sizes cannot, so
 * they travel on their own channel — see `ResolutionSettings`. */
export interface NumericSettings {
  velocityDissipation: number;
  dyeDissipation: number;
  splatRadius: number;
  splatForce: number;
  pressureIterations: number;
  vorticityConfinement: number;
  buoyancy: number;
  heatCooling: number;
}

export interface FluidSettings extends NumericSettings {
  wrapEdges: boolean;
}

const NUMERIC_DEFAULTS: NumericSettings = {
  velocityDissipation: VELOCITY_DISSIPATION,
  dyeDissipation: DYE_DISSIPATION,
  splatRadius: SPLAT_RADIUS,
  splatForce: SPLAT_FORCE,
  pressureIterations: PRESSURE_ITERATIONS,
  vorticityConfinement: VORTICITY_CONFINEMENT,
  buoyancy: BUOYANCY_STRENGTH,
  heatCooling: HEAT_COOLING,
};

export const DEFAULT_SETTINGS: FluidSettings = {
  ...NUMERIC_DEFAULTS,
  wrapEdges: false,
};

export const SETTING_DESCRIPTORS: readonly SettingDescriptor<
  keyof NumericSettings
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
  {
    key: "vorticityConfinement",
    label: "Vorticity",
    min: 0,
    max: 50,
    step: 1,
    precision: 0,
  },
  {
    key: "buoyancy",
    label: "Buoyancy",
    min: 0,
    max: 100,
    step: 1,
    precision: 0,
  },
  // Floor above zero: heat must always decay.
  {
    key: "heatCooling",
    label: "Heat cooling",
    min: 0.05,
    max: 5,
    step: 0.05,
    precision: 2,
  },
];

const settings = describeSettings(SETTING_DESCRIPTORS, NUMERIC_DEFAULTS);

export const clampSetting = settings.clamp;

export const normaliseSettings = (input: unknown): FluidSettings => {
  const wrapEdges =
    typeof input === "object" && input !== null && "wrapEdges" in input
      ? input.wrapEdges
      : undefined;
  return {
    ...settings.normalise(input),
    wrapEdges:
      typeof wrapEdges === "boolean" ? wrapEdges : DEFAULT_SETTINGS.wrapEdges,
  };
};
