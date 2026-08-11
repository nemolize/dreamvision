import { hueToRgb } from "./color";
import {
  SEED_DYE_GAIN,
  SEED_SPLAT_FORCE,
  SEED_SPLATS_MAX,
  SEED_SPLATS_MIN,
} from "./config";
import type { Splat } from "./types";

/** Draws in 0..1. */
export type Random = () => number;

/** Off leaves only the pointer's dye on the canvas, so a test can attribute
 * what it sees to the drag — seeded dye is indistinguishable from dragged. */
export const seedEnabled = (search: string): boolean =>
  new URLSearchParams(search).get("seed") !== "off";

export const randomSplat = (random: Random): Splat => {
  const angle = random() * Math.PI * 2;
  const [r, g, b] = hueToRgb(random());
  return {
    x: random(),
    y: random(),
    dx: Math.cos(angle) * SEED_SPLAT_FORCE,
    dy: Math.sin(angle) * SEED_SPLAT_FORCE,
    color: [r * SEED_DYE_GAIN, g * SEED_DYE_GAIN, b * SEED_DYE_GAIN],
  };
};

/** The opening burst, so the first frame already has colour moving in it. */
export const seedSplats = (random: Random): Splat[] => {
  const span = SEED_SPLATS_MAX - SEED_SPLATS_MIN + 1;
  const count = SEED_SPLATS_MIN + Math.floor(random() * span);
  return Array.from({ length: count }, () => randomSplat(random));
};
