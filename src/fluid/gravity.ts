import { GRAVITY_MIN_TILT, GRAVITY_SMOOTHING_SECONDS } from "./config";

export type Direction = readonly [number, number];

export const DEFAULT_UP: Direction = [0, -1];

export interface GravityReading {
  x: number | null;
  y: number | null;
}

/** A resting device reports the reaction to gravity, so the reading already
 * points up; the screen angle (counter-clockwise device turn) rotates it. */
export const upFromReading = (
  reading: GravityReading | null,
  angleDegrees: number,
): Direction | null => {
  const x = reading?.x;
  const y = reading?.y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const tilt = Math.hypot(x, y);
  if (tilt < GRAVITY_MIN_TILT) return null;

  const angle = (angleDegrees * Math.PI) / 180;
  const right = x * Math.cos(angle) - y * Math.sin(angle);
  const above = x * Math.sin(angle) + y * Math.cos(angle);
  return [right / tilt, -above / tilt];
};

/** Eases along the shorter arc, so a target opposite `current` still turns. */
export const easeDirection = (
  current: Direction,
  target: Direction,
  dt: number,
): Direction => {
  const blend = 1 - Math.exp(-Math.max(dt, 0) / GRAVITY_SMOOTHING_SECONDS);
  if (blend === 0) return current;
  const from = Math.atan2(current[1], current[0]);
  const gap = Math.atan2(
    current[0] * target[1] - current[1] * target[0],
    current[0] * target[0] + current[1] * target[1],
  );
  // Exactly opposite has no shorter arc; either way round, take the same one.
  const turn = Math.abs(gap) === Math.PI ? Math.PI : gap;
  if (turn === 0) return current;
  const angle = from + turn * blend;
  return [Math.cos(angle), Math.sin(angle)];
};

export class GravityTracker {
  private target: Direction = DEFAULT_UP;
  private current: Direction = DEFAULT_UP;

  update(reading: GravityReading | null, angleDegrees: number): void {
    this.target = upFromReading(reading, angleDegrees) ?? this.target;
  }

  step(dt: number): Direction {
    this.current = easeDirection(this.current, this.target, dt);
    return this.current;
  }
}
