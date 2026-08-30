import { describe, expect, it } from "vitest";

import { SPLAT_FORCE } from "./config";
import { PointerTracker } from "./pointer";
import type { Splat } from "./types";

const only = (splats: readonly Splat[]): Splat => {
  const [first] = splats;
  if (splats.length !== 1 || first === undefined) {
    throw new Error(`expected exactly one splat, got ${String(splats.length)}`);
  }
  return first;
};

describe("PointerTracker", () => {
  it("produces no splat before any interaction", () => {
    expect(new PointerTracker().consume()).toEqual([]);
  });

  it("ignores movement while the pointer is up", () => {
    const tracker = new PointerTracker();
    tracker.move(1, 0.5, 0.5);
    expect(tracker.consume()).toEqual([]);
  });

  it("accumulates motion across several moves within one frame", () => {
    const tracker = new PointerTracker();
    tracker.press(1, 0.5, 0.5);
    tracker.move(1, 0.6, 0.5);
    tracker.move(1, 0.7, 0.5);

    const sample = only(tracker.consume());
    expect(sample.x).toBeCloseTo(0.7, 6);
    // Both steps contribute, so the force is the whole 0.5 -> 0.7 travel.
    expect(sample.dx).toBeCloseTo(0.2 * SPLAT_FORCE, 3);
    expect(sample.dy).toBeCloseTo(0, 6);
  });

  it("clears motion once consumed so a still pointer applies no force", () => {
    const tracker = new PointerTracker();
    tracker.press(1, 0.5, 0.5);
    tracker.move(1, 0.6, 0.5);
    tracker.consume();

    // A held pointer still splats — at zero force, so it only keeps feeding
    // colour at rest.
    const sample = only(tracker.consume());
    expect(sample.dx).toBe(0);
    expect(sample.dy).toBe(0);
    expect(sample.x).toBeCloseTo(0.6, 6);
  });

  it("stops splatting after release", () => {
    const tracker = new PointerTracker();
    tracker.press(1, 0.5, 0.5);
    tracker.release(1);
    tracker.move(1, 0.9, 0.9);

    expect(tracker.consume()).toEqual([]);
  });

  it("still splats a drag that began and ended between two frames", () => {
    const tracker = new PointerTracker();
    tracker.press(1, 0.2, 0.5);
    tracker.move(1, 0.6, 0.5);
    tracker.release(1);

    // The button is already up, but this motion has never been rendered —
    // dropping it would lose the whole drag.
    const sample = only(tracker.consume());
    expect(sample.x).toBeCloseTo(0.6, 6);
    expect(sample.dx).toBeCloseTo(0.4 * SPLAT_FORCE, 3);

    // Drained: the next frame must not splat the same motion again.
    expect(tracker.consume()).toEqual([]);
  });

  it("scales the splat by the force set on it", () => {
    const tracker = new PointerTracker();
    tracker.setForce(10);
    tracker.press(1, 0.5, 0.5);
    tracker.move(1, 0.6, 0.5);

    expect(only(tracker.consume()).dx).toBeCloseTo(0.1 * 10, 6);
  });

  it("applies a force changed mid-drag to the motion already accumulated", () => {
    const tracker = new PointerTracker();
    tracker.setForce(10);
    tracker.press(1, 0.5, 0.5);
    tracker.move(1, 0.6, 0.5);
    tracker.setForce(20);

    expect(only(tracker.consume()).dx).toBeCloseTo(0.1 * 20, 6);
  });

  it("does not carry motion across a re-press of the same pointer", () => {
    const tracker = new PointerTracker();
    tracker.press(1, 0.1, 0.1);
    tracker.move(1, 0.4, 0.1);
    tracker.press(1, 0.8, 0.8);

    expect(only(tracker.consume())).toMatchObject({
      x: 0.8,
      y: 0.8,
      dx: 0,
      dy: 0,
    });
  });

  it("splats each pressed pointer separately", () => {
    const tracker = new PointerTracker();
    tracker.press(1, 0.2, 0.2);
    tracker.press(2, 0.8, 0.8);
    tracker.move(1, 0.3, 0.2);
    tracker.move(2, 0.8, 0.6);

    const splats = tracker.consume();
    expect(splats).toHaveLength(2);
    expect(splats[0]).toMatchObject({ x: 0.3, y: 0.2 });
    expect(splats[0]?.dx).toBeCloseTo(0.1 * SPLAT_FORCE, 3);
    expect(splats[1]).toMatchObject({ x: 0.8, y: 0.6 });
    expect(splats[1]?.dy).toBeCloseTo(-0.2 * SPLAT_FORCE, 3);
  });

  it("leaves a live stroke untouched when another pointer presses", () => {
    const tracker = new PointerTracker();
    tracker.press(1, 0.2, 0.5);
    tracker.move(1, 0.4, 0.5);
    tracker.press(2, 0.9, 0.9);

    const first = tracker.consume().find((splat) => splat.x === 0.4);
    expect(first?.dx).toBeCloseTo(0.2 * SPLAT_FORCE, 3);
  });

  it("keeps a held pointer splatting after another pointer is released", () => {
    const tracker = new PointerTracker();
    tracker.press(1, 0.2, 0.5);
    tracker.press(2, 0.9, 0.9);
    tracker.release(2);
    tracker.consume();

    tracker.move(1, 0.5, 0.5);
    const sample = only(tracker.consume());
    expect(sample.x).toBeCloseTo(0.5, 6);
    expect(sample.dx).toBeCloseTo(0.3 * SPLAT_FORCE, 3);
  });

  it("gives each pointer its own colour", () => {
    const tracker = new PointerTracker();
    tracker.press(1, 0.2, 0.2);
    tracker.press(2, 0.8, 0.8);

    const splats = tracker.consume();
    // Colours are random, so this asserts they are drawn per stroke rather
    // than shared by reference — not that the two values differ.
    expect(splats[0]?.color).not.toBe(splats[1]?.color);
  });

  it("ignores a release for a pointer it never saw", () => {
    const tracker = new PointerTracker();
    tracker.press(1, 0.5, 0.5);
    tracker.release(99);

    expect(only(tracker.consume()).x).toBeCloseTo(0.5, 6);
  });

  it("drops a released stroke rather than retaining it per touch", () => {
    const tracker = new PointerTracker();
    for (let id = 0; id < 50; id++) {
      tracker.press(id, 0.5, 0.5);
      tracker.release(id);
      tracker.consume();
    }

    expect(tracker.consume()).toEqual([]);
  });
});
