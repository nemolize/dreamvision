import { randomColor } from "./color";
import { SPLAT_FORCE } from "./config";
import type { Splat } from "./types";

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
  /** Motion arrived since the last `consume`, so it is still unsplatted even
   * if the pointer has been released since. */
  private pending = false;
  private color = randomColor();
  private force = SPLAT_FORCE;

  setForce(force: number): void {
    this.force = force;
  }

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
    this.dx += x - this.x;
    this.dy += y - this.y;
    this.x = x;
    this.y = y;
    this.pending = true;
  }

  release(): void {
    this.active = false;
  }

  /** Read the frame's input and clear it. A drag that began and ended between
   * two frames still yields a splat — its motion has never been rendered. */
  consume(): Splat | null {
    if (!this.active && !this.pending) return null;

    const splat: Splat = {
      x: this.x,
      y: this.y,
      dx: this.dx * this.force,
      dy: this.dy * this.force,
      color: this.color,
    };
    this.dx = 0;
    this.dy = 0;
    this.pending = false;
    return splat;
  }
}
