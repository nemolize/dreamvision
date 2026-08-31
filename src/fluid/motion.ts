import { MAX_STEPS_PER_FRAME, TIME_STEP } from "./config";

/** Narrower than `Window` so a caller without `matchMedia` — an older browser,
 * a bare test double — is a type the signature admits rather than a cast. */
export interface MotionQuery {
  matches: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

export interface MotionQueryView {
  matchMedia?: (query: string) => MotionQuery;
}

export const reducedMotionQuery = (view: MotionQueryView): MotionQuery | null =>
  view.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;

/** Clamped, not dropped: a slow renderer legitimately exceeds the budget every
 * frame, and discarding those gaps would stop the simulation advancing at all. */
const MAX_FRAME_GAP_SECONDS = MAX_STEPS_PER_FRAME * TIME_STEP;

/** Separate from the closed-gate branch because `visibilitychange` reopens the
 * gate before the first resumed frame, so that gap sees an open one. */
export const creditedElapsed = (elapsed: number): number =>
  Math.min(elapsed, MAX_FRAME_GAP_SECONDS);

export class MotionGate {
  private reducedMotion: boolean;
  private hidden: boolean;
  private awaitingInput: boolean;

  constructor(reducedMotion: boolean, hidden: boolean) {
    this.reducedMotion = reducedMotion;
    this.hidden = hidden;
    this.awaitingInput = reducedMotion;
  }

  /** Enabling the preference mid-session re-arms the hold, so someone who turns
   * it on because the motion is affecting them gets stillness without a reload. */
  setReducedMotion(reducedMotion: boolean): void {
    this.reducedMotion = reducedMotion;
    this.awaitingInput = reducedMotion;
  }

  /** The opening burst is motion the user never asked for, so the preference
   * suppresses it outright rather than damping it. */
  get seeds(): boolean {
    return !this.reducedMotion;
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
  }

  /** Lifts the reduced-motion hold for the session. Visibility is deliberately
   * unaffected: un-hiding a tab is not a request to animate. */
  requestMotion(): void {
    this.awaitingInput = false;
  }

  get open(): boolean {
    return !this.hidden && !this.awaitingInput;
  }
}
