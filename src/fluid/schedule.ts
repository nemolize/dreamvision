import { REFERENCE_STEP } from "./config";
import { creditedElapsed } from "./motion";
import type { Splat } from "./types";

export interface FrameSink {
  consume: () => readonly Splat[];
  frame: (splats: readonly Splat[], dt: number) => void;
}

const scaleDye = (splat: Splat, gain: number): Splat => ({
  ...splat,
  color: [splat.color[0] * gain, splat.color[1] * gain, splat.color[2] * gain],
});

/** Apart from the effect because `FluidCanvas`'s renderer needs a GPU adapter,
 * so a rule left inline there is reachable by no unit test. */
export class FrameSchedule {
  private pending: Splat[];

  /** Held until a frame advances, and never scaled: a seed is a one-off. */
  constructor(seeds: readonly Splat[] = []) {
    this.pending = [...seeds];
  }

  advance(elapsedSeconds: number, sink: FrameSink): number {
    const dt = creditedElapsed(elapsedSeconds);
    if (dt <= 0) return 0;

    const gain = dt / REFERENCE_STEP;
    this.pending.push(...sink.consume().map((splat) => scaleDye(splat, gain)));
    sink.frame(this.pending, dt);
    this.pending = [];

    return dt;
  }
}
