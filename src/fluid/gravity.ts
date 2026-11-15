import { GRAVITY_MIN_TILT, GRAVITY_SMOOTHING_SECONDS } from "./config";

export type Direction = readonly [number, number];

export const DEFAULT_UP: Direction = [0, -1];

export interface GravityReading {
  x: number | null;
  y: number | null;
  z?: number | null;
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

const ZERO_FORCE: Direction = [0, 0];

/** Hot dye is the lighter fluid, so a device's acceleration pushes it the same
 * way; a missing or non-finite axis is none. */
export const shakeFromAcceleration = (
  reading: GravityReading | null,
  angleDegrees: number,
): Direction => {
  const x = reading?.x;
  const y = reading?.y;
  if (typeof x !== "number" || typeof y !== "number") return ZERO_FORCE;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return ZERO_FORCE;

  const angle = (angleDegrees * Math.PI) / 180;
  const right = x * Math.cos(angle) - y * Math.sin(angle);
  const above = x * Math.sin(angle) + y * Math.cos(angle);
  return [right, -above];
};

/** Keeps a translation out of `up`, which `shakeFromAcceleration` already counts. */
export const withoutAcceleration = (
  including: GravityReading | null,
  acceleration: GravityReading | null,
): GravityReading | null => {
  const x = acceleration?.x;
  const y = acceleration?.y;
  if (including === null || typeof x !== "number" || typeof y !== "number") {
    return including;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return including;
  if (typeof including.x !== "number" || typeof including.y !== "number") {
    return including;
  }
  const z = acceleration?.z;
  const zWithGravity = including.z ?? null;
  return {
    x: including.x - x,
    y: including.y - y,
    z:
      zWithGravity !== null && typeof z === "number" && Number.isFinite(z)
        ? zWithGravity - z
        : zWithGravity,
  };
};

export const inPlaneShare = (reading: GravityReading | null): number | null => {
  const x = reading?.x;
  const y = reading?.y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const z = reading?.z;
  if (typeof z !== "number" || !Number.isFinite(z)) return 1;
  const full = Math.hypot(x, y, z);
  return full === 0 ? null : Math.hypot(x, y) / full;
};

const blendFactor = (dt: number): number =>
  1 - Math.exp(-Math.max(dt, 0) / GRAVITY_SMOOTHING_SECONDS);

/** Eases along the shorter arc, so a target opposite `current` still turns. */
export const easeDirection = (
  current: Direction,
  target: Direction,
  dt: number,
): Direction => {
  const blend = blendFactor(dt);
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

/** Steps the lift's direction, scaled by `inPlaneShare`; also holds the latest
 * shake force, which is not eased. */
export class GravityTracker {
  private target: Direction = DEFAULT_UP;
  private current: Direction = DEFAULT_UP;
  private targetShare = 1;
  private currentShare = 1;
  private shaking: Direction = ZERO_FORCE;

  update(reading: GravityReading | null, angleDegrees: number): void {
    this.target = upFromReading(reading, angleDegrees) ?? this.target;
    this.targetShare = inPlaneShare(reading) ?? this.targetShare;
  }

  updateShake(reading: GravityReading | null, angleDegrees: number): void {
    this.shaking = shakeFromAcceleration(reading, angleDegrees);
  }

  shake(): Direction {
    return this.shaking;
  }

  step(dt: number): Direction {
    this.current = easeDirection(this.current, this.target, dt);
    this.currentShare +=
      (this.targetShare - this.currentShare) * blendFactor(dt);
    return [
      this.current[0] * this.currentShare,
      this.current[1] * this.currentShare,
    ];
  }
}
