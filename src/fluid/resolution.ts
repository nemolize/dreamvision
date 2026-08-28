import { DYE_RESOLUTION, SIM_RESOLUTION } from "./config";
import type { SettingDescriptor } from "./descriptor";
import { describeSettings } from "./descriptor";

/** Held apart from `FluidSettings` because these cannot take effect on the next
 * frame: changing one rebuilds every texture. */
export interface ResolutionSettings {
  simResolution: number;
  dyeResolution: number;
}

export const DEFAULT_RESOLUTION: ResolutionSettings = {
  simResolution: SIM_RESOLUTION,
  dyeResolution: DYE_RESOLUTION,
};

/** Two sliders rather than one quality dial: the grids are sized for different
 * reasons, so a fixed ratio would hide the trade the panel exists to offer. */
export const RESOLUTION_DESCRIPTORS: readonly SettingDescriptor<
  keyof ResolutionSettings
>[] = [
  {
    key: "simResolution",
    label: "Sim grid",
    min: 64,
    max: 512,
    step: 32,
    precision: 0,
  },
  {
    key: "dyeResolution",
    label: "Dye grid",
    min: 256,
    max: 2048,
    step: 128,
    precision: 0,
  },
];

export const sameResolution = (
  a: ResolutionSettings,
  b: ResolutionSettings,
): boolean =>
  a.simResolution === b.simResolution && a.dyeResolution === b.dyeResolution;

const resolution = describeSettings(RESOLUTION_DESCRIPTORS, DEFAULT_RESOLUTION);

export const clampResolution = resolution.clamp;

export const normaliseResolution = (input: unknown): ResolutionSettings =>
  resolution.normalise(input);
