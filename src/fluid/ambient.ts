import {
  AMBIENT_DYE_GAIN,
  AMBIENT_SPLAT_FORCE,
  IDLE_DELAY_SECONDS,
  IDLE_INTERVAL_SECONDS,
  SEED_SPLATS_MAX,
  SEED_SPLATS_MIN,
} from "./config";
import { hueToRgb } from "./pointer";
import type { Splat } from "./types";

/** Draws in 0..1. Injected so the tests can drive the generators from a known
 * sequence rather than asserting on whatever `Math.random` returned. */
export type Random = () => number;

/** A splat at a random point, thrown in a random direction. */
export const randomSplat = (random: Random): Splat => {
  const angle = random() * Math.PI * 2;
  const [r, g, b] = hueToRgb(random());
  return {
    x: random(),
    y: random(),
    dx: Math.cos(angle) * AMBIENT_SPLAT_FORCE,
    dy: Math.sin(angle) * AMBIENT_SPLAT_FORCE,
    color: [r * AMBIENT_DYE_GAIN, g * AMBIENT_DYE_GAIN, b * AMBIENT_DYE_GAIN],
  };
};

/** The opening burst, so the first frame already has colour moving in it. */
export const seedSplats = (random: Random): Splat[] => {
  const span = SEED_SPLATS_MAX - SEED_SPLATS_MIN + 1;
  const count = SEED_SPLATS_MIN + Math.floor(random() * span);
  return Array.from({ length: count }, () => randomSplat(random));
};

/**
 * Feeds the simulation while nobody is touching it. Dye dissipates, so an
 * untouched page fades back to black within seconds of the seed burst; this
 * keeps one drifting in every so often until the pointer takes over.
 */
export class IdleSplatter {
  /** Seconds since the last splat from any source, pointer included. */
  private quiet = 0;

  /** Report pointer activity, which restarts the idle countdown. */
  notifyActivity(): void {
    this.quiet = 0;
  }

  /** Advance by `dt` seconds and return the splat now due, if any. */
  step(dt: number, random: Random): Splat | null {
    this.quiet += dt;
    if (this.quiet < IDLE_DELAY_SECONDS) return null;

    // Counted from the delay rather than reset to zero, so the interval governs
    // the gap between idle splats while the longer delay applies only once.
    this.quiet = IDLE_DELAY_SECONDS - IDLE_INTERVAL_SECONDS;
    return randomSplat(random);
  }
}
