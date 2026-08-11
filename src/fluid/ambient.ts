import { hueToRgb } from "./color";
import {
  AMBIENT_DYE_GAIN,
  AMBIENT_SPLAT_FORCE,
  IDLE_DELAY_SECONDS,
  IDLE_INTERVAL_SECONDS,
  SEED_SPLATS_MAX,
  SEED_SPLATS_MIN,
} from "./config";
import type { Splat } from "./types";

/** Draws in 0..1. */
export type Random = () => number;

/** Which uninvited splat sources are live. Both on unless asked otherwise —
 * the switches exist so a test can attribute dye to one source, which it
 * cannot do while another is painting the same canvas. */
export interface AmbientSources {
  seed: boolean;
  idle: boolean;
}

/** `?ambient=off` silences both; `?ambient=seed` / `?ambient=idle` keep only
 * the named one. */
export const ambientSources = (search: string): AmbientSources => {
  switch (new URLSearchParams(search).get("ambient")) {
    case "off":
      return { seed: false, idle: false };
    case "seed":
      return { seed: true, idle: false };
    case "idle":
      return { seed: false, idle: true };
    default:
      return { seed: true, idle: true };
  }
};

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
  /** Idle time counted toward the next splat. Pointer activity resets it; an
   * idle splat rewinds it by one interval, so only the first wait is the full
   * delay. */
  private quiet = 0;

  notifyActivity(): void {
    this.quiet = 0;
  }

  step(dt: number, random: Random): Splat | null {
    this.quiet += dt;
    if (this.quiet < IDLE_DELAY_SECONDS) return null;

    this.quiet = IDLE_DELAY_SECONDS - IDLE_INTERVAL_SECONDS;
    return randomSplat(random);
  }
}
