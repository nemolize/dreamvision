import { SPLAT_FORCE } from "./config";
import type { Pointer } from "./types";

/** Dye is additive and unbounded, so a splat starts dim and brightens as the
 * pointer lingers. */
export const DYE_INTENSITY = 0.25;

/** A fully-saturated colour at hue `h` (0..1) — the HSV-to-RGB conversion with
 * s = v = 1, which keeps successive splats vivid rather than averaging to grey. */
export const hueToRgb = (h: number): [number, number, number] => {
  const channel = (offset: number): number => {
    const position = (h * 6 + offset) % 6;
    return Math.max(0, Math.min(1, Math.min(position, 4 - position, 1)));
  };
  return [
    channel(2) * DYE_INTENSITY,
    channel(0) * DYE_INTENSITY,
    channel(4) * DYE_INTENSITY,
  ];
};

export const randomColor = (): [number, number, number] =>
  hueToRgb(Math.random());

/**
 * Tracks the pointer in normalised canvas space and produces the per-frame
 * splat input. Deliberately not React state: it changes on every pointermove
 * and nothing in the tree renders from it.
 */
export class PointerTracker {
  private x = 0;
  private y = 0;
  private dx = 0;
  private dy = 0;
  private active = false;
  private color = randomColor();

  press(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.dx = 0;
    this.dy = 0;
    this.active = true;
    this.color = randomColor();
  }

  move(x: number, y: number): void {
    if (!this.active) return;
    this.dx += (x - this.x) * SPLAT_FORCE;
    this.dy += (y - this.y) * SPLAT_FORCE;
    this.x = x;
    this.y = y;
  }

  release(): void {
    this.active = false;
  }

  /** Read the accumulated motion and clear it, so a frame that renders twice
   * without a pointermove does not apply the same force again. */
  consume(): Pointer {
    const sample: Pointer = {
      x: this.x,
      y: this.y,
      dx: this.dx,
      dy: this.dy,
      down: this.active,
      color: this.color,
    };
    this.dx = 0;
    this.dy = 0;
    return sample;
  }
}
