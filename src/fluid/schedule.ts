import { MAX_STEPS_PER_FRAME, TIME_STEP } from "./config";
import { creditedElapsed } from "./motion";
import type { Splat } from "./types";

export interface FrameSink {
  consume: () => readonly Splat[];
  frame: (splats: readonly Splat[]) => void;
}

/** Apart from the effect because `FluidCanvas`'s renderer needs a GPU adapter,
 * so a rule left inline there is reachable by no unit test. */
export class FrameSchedule {
  private owed = 0;
  private pending: Splat[];

  /** Held rather than drawn now, because a frame can render before enough time
   * accrues for a step and the burst has to land inside one. */
  constructor(seeds: readonly Splat[] = []) {
    this.pending = [...seeds];
  }

  /** Discarded because a reopened gate would otherwise replay the whole gap. */
  pause(): void {
    this.owed = 0;
  }

  advance(elapsedSeconds: number, sink: FrameSink): number {
    this.owed += creditedElapsed(elapsedSeconds);

    const steps = Math.min(
      Math.floor(this.owed / TIME_STEP),
      MAX_STEPS_PER_FRAME,
    );
    this.owed -= steps * TIME_STEP;

    for (let step = 0; step < steps; step++) {
      // First step only, because accruing across stepless frames overflows the
      // cap renderer.ts silently slices at, and replaying scales the force.
      if (step === 0) this.pending.push(...sink.consume());
      sink.frame(this.pending);
      this.pending = [];
    }

    return steps;
  }
}
