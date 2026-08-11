import { describe, expect, it } from "vitest";

import { SPLAT_FORCE } from "./config";
import { PointerTracker } from "./pointer";
import type { Splat } from "./types";

/** Narrow away the "nothing to splat" case, so a test asserting on a splat's
 * contents fails loudly rather than on a property of `null`. */
const splatted = (splat: Splat | null): Splat => {
  if (splat === null) throw new Error("expected a splat, got none");
  return splat;
};

describe("PointerTracker", () => {
  it("produces no splat before any interaction", () => {
    expect(new PointerTracker().consume()).toBeNull();
  });

  it("ignores movement while the pointer is up", () => {
    const tracker = new PointerTracker();
    tracker.move(0.5, 0.5);
    expect(tracker.consume()).toBeNull();
  });

  it("accumulates motion across several moves within one frame", () => {
    const tracker = new PointerTracker();
    tracker.press(0.5, 0.5);
    tracker.move(0.6, 0.5);
    tracker.move(0.7, 0.5);

    const sample = splatted(tracker.consume());
    expect(sample.x).toBeCloseTo(0.7, 6);
    // Both steps contribute, so the force is the whole 0.5 -> 0.7 travel.
    expect(sample.dx).toBeCloseTo(0.2 * SPLAT_FORCE, 3);
    expect(sample.dy).toBeCloseTo(0, 6);
  });

  it("clears motion once consumed so a still pointer applies no force", () => {
    const tracker = new PointerTracker();
    tracker.press(0.5, 0.5);
    tracker.move(0.6, 0.5);
    tracker.consume();

    // A held pointer still splats — at zero force, so it only keeps feeding
    // colour at rest.
    const sample = splatted(tracker.consume());
    expect(sample.dx).toBe(0);
    expect(sample.dy).toBe(0);
    expect(sample.x).toBeCloseTo(0.6, 6);
  });

  it("stops splatting after release", () => {
    const tracker = new PointerTracker();
    tracker.press(0.5, 0.5);
    tracker.release();
    tracker.move(0.9, 0.9);

    expect(tracker.consume()).toBeNull();
  });

  it("still splats a drag that began and ended between two frames", () => {
    const tracker = new PointerTracker();
    tracker.press(0.2, 0.5);
    tracker.move(0.6, 0.5);
    tracker.release();

    // The button is already up, but this motion has never been rendered —
    // dropping it would lose the whole drag.
    const sample = splatted(tracker.consume());
    expect(sample.x).toBeCloseTo(0.6, 6);
    expect(sample.dx).toBeCloseTo(0.4 * SPLAT_FORCE, 3);

    // Drained: the next frame must not splat the same motion again.
    expect(tracker.consume()).toBeNull();
  });

  it("does not carry motion across a press", () => {
    const tracker = new PointerTracker();
    tracker.press(0.1, 0.1);
    tracker.move(0.4, 0.1);
    tracker.press(0.8, 0.8);

    expect(tracker.consume()).toMatchObject({ x: 0.8, y: 0.8, dx: 0, dy: 0 });
  });
});
