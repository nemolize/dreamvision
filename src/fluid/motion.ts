/** Narrower than `Window` so a caller without `matchMedia` — an older browser,
 * a bare test double — is a type the signature admits rather than a cast. */
export interface MotionQueryView {
  matchMedia?: (query: string) => { matches: boolean };
}

export const prefersReducedMotion = (view: MotionQueryView): boolean =>
  view.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** `MAX_STEPS_PER_FRAME` bounds the catch-up replay after an idle gap but does
 * not prevent it, so time accumulated while closed must be discarded. */
export class MotionGate {
  private readonly reducedMotion: boolean;
  private hidden: boolean;
  private awaitingInput: boolean;

  constructor(reducedMotion: boolean, hidden: boolean) {
    this.reducedMotion = reducedMotion;
    this.hidden = hidden;
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
