import { randomColor } from "./color";
import { SPLAT_FORCE } from "./config";
import type { Splat } from "./types";

interface Stroke {
  x: number;
  y: number;
  dx: number;
  dy: number;
  active: boolean;
  pending: boolean;
  color: readonly [number, number, number];
}

/**
 * Deliberately not React state: it changes on every pointermove and nothing in
 * the tree renders from it. Keyed by `pointerId` because one shared stroke let
 * a second finger's press teleport the first and its release end a live drag.
 */
export class PointerTracker {
  private strokes = new Map<number, Stroke>();
  private force = SPLAT_FORCE;

  setForce(force: number): void {
    this.force = force;
  }

  press(id: number, x: number, y: number): void {
    this.strokes.set(id, {
      x,
      y,
      dx: 0,
      dy: 0,
      active: true,
      pending: false,
      color: randomColor(),
    });
  }

  move(id: number, x: number, y: number): void {
    const stroke = this.strokes.get(id);
    if (stroke?.active !== true) return;
    stroke.dx += x - stroke.x;
    stroke.dy += y - stroke.y;
    stroke.x = x;
    stroke.y = y;
    stroke.pending = true;
  }

  release(id: number): void {
    const stroke = this.strokes.get(id);
    if (stroke !== undefined) stroke.active = false;
  }

  /** A released stroke is still drained once, because a drag that began and
   * ended between two frames has never been rendered and dropping it would lose
   * the whole gesture. */
  consume(): Splat[] {
    const splats: Splat[] = [];

    for (const [id, stroke] of this.strokes) {
      if (!stroke.active && !stroke.pending) {
        this.strokes.delete(id);
        continue;
      }

      splats.push({
        x: stroke.x,
        y: stroke.y,
        dx: stroke.dx * this.force,
        dy: stroke.dy * this.force,
        color: stroke.color,
      });
      stroke.dx = 0;
      stroke.dy = 0;
      stroke.pending = false;
    }

    return splats;
  }
}
