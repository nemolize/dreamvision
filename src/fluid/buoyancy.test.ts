import { describe, expect, it } from "vitest";

import { BUOYANCY_STRENGTH, HEAT_COOLING, REFERENCE_STEP } from "./config";
import { GravityTracker } from "./gravity";
import { projectionScale } from "./projection";
import simulationShaderSource from "./simulation.wgsl?raw";

// CPU twin of the `buoyancy` pass and the heat decay, transcribed by hand:
// editing either in `simulation.wgsl` means editing its twin here.

interface Field {
  readonly width: number;
  readonly height: number;
  readonly data: Float64Array;
}

const fieldFrom = (
  width: number,
  height: number,
  value: (x: number, y: number) => number,
): Field => {
  const data = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = value(x, y);
  }
  return { width, height, data };
};

const at = (f: Field, x: number, y: number, wrap: boolean): number => {
  const cx = wrap
    ? ((x % f.width) + f.width) % f.width
    : Math.min(Math.max(x, 0), f.width - 1);
  const cy = wrap
    ? ((y % f.height) + f.height) % f.height
    : Math.min(Math.max(y, 0), f.height - 1);
  return f.data[cy * f.width + cx] ?? 0;
};

const sample = (f: Field, x: number, y: number, wrap: boolean): number => {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const fx = x - bx;
  const fy = y - by;
  const top = at(f, bx, by, wrap) * (1 - fx) + at(f, bx + 1, by, wrap) * fx;
  const bottom =
    at(f, bx, by + 1, wrap) * (1 - fx) + at(f, bx + 1, by + 1, wrap) * fx;
  return top * (1 - fy) + bottom * fy;
};

interface Velocity {
  readonly x: Field;
  readonly y: Field;
}

type Direction = readonly [number, number];

const buoyancy = (
  u: Velocity,
  heat: Field,
  strength: number,
  up: Direction,
  dt: number,
  wrap: boolean,
): Velocity => {
  const { width, height } = u.x;
  const scale = projectionScale(width, height);
  const heatAt = (x: number, y: number): number =>
    sample(
      heat,
      ((x + 0.5) / width) * heat.width - 0.5,
      ((y + 0.5) / height) * heat.height - 0.5,
      wrap,
    );
  const lift = (axis: 0 | 1, x: number, y: number): number =>
    (axis === 0 ? scale.toStoredX : scale.toStoredY) *
    strength *
    heatAt(x, y) *
    up[axis] *
    dt;
  return {
    x: fieldFrom(width, height, (x, y) => at(u.x, x, y, wrap) + lift(0, x, y)),
    y: fieldFrom(width, height, (x, y) => at(u.y, x, y, wrap) + lift(1, x, y)),
  };
};

const rest = (width: number, height: number): Velocity => ({
  x: fieldFrom(width, height, () => 0),
  y: fieldFrom(width, height, () => 0),
});

const blob = (width: number, height: number): Field =>
  fieldFrom(width, height, (x, y) => {
    const dx = (x + 0.5) / width - 0.5;
    const dy = (y + 0.5) / height - 0.5;
    return Math.exp(-(dx * dx + dy * dy) / 0.01);
  });

const DT = REFERENCE_STEP;
const UP: Direction = [0, -1];
const SIDE: Direction = [1, 0];

const along = (u: Velocity, up: Direction, x: number, y: number): number =>
  at(u.x, x, y, false) * up[0] + at(u.y, x, y, false) * up[1];

describe("buoyancy", () => {
  const n = 16;
  const heat = blob(n, n);
  const centre = n / 2;

  it("lifts a hot cell along the up direction", () => {
    const lifted = buoyancy(rest(n, n), heat, 10, UP, DT, false);
    expect(along(lifted, UP, centre, centre)).toBeGreaterThan(0);
  });

  it("adds nothing along it at strength 0", () => {
    const lifted = buoyancy(rest(n, n), heat, 0, UP, DT, false);
    expect(along(lifted, UP, centre, centre)).toBe(0);
  });

  it("adds nothing where there is no heat", () => {
    const cold = fieldFrom(n, n, () => 0);
    const lifted = buoyancy(rest(n, n), cold, 10, UP, DT, false);
    expect(Math.max(...lifted.y.data.map(Math.abs))).toBe(0);
  });

  it("scales with the strength, the heat and the step", () => {
    const base = along(
      buoyancy(rest(n, n), heat, 10, UP, DT, false),
      UP,
      centre,
      centre,
    );
    const stronger = along(
      buoyancy(rest(n, n), heat, 20, UP, DT, false),
      UP,
      centre,
      centre,
    );
    const longer = along(
      buoyancy(rest(n, n), heat, 10, UP, 2 * DT, false),
      UP,
      centre,
      centre,
    );
    expect(stronger).toBeCloseTo(2 * base, 12);
    expect(longer).toBeCloseTo(2 * base, 12);
  });

  it("reads the heat off a finer grid at the cell's own centre", () => {
    const fine = fieldFrom(2 * n, 2 * n, (x, y) => (x + y) % 2);
    const lifted = buoyancy(rest(n, n), fine, 10, UP, DT, false);
    const half = buoyancy(
      rest(n, n),
      fieldFrom(n, n, () => 0.5),
      10,
      UP,
      DT,
      false,
    );
    expect(lifted.y.data[centre * n + centre]).toBeCloseTo(
      half.y.data[centre * n + centre] ?? 0,
      12,
    );
  });

  it("turns the lift with the gravity reading", () => {
    const tracker = new GravityTracker();
    tracker.update({ x: 9.8, y: 0 }, 0);
    const turned = tracker.step(100);
    const lifted = buoyancy(rest(n, n), heat, 10, turned, DT, false);
    expect(along(lifted, SIDE, centre, centre)).toBeGreaterThan(0);
    expect(Math.abs(at(lifted.y, centre, centre, false))).toBeLessThan(1e-9);

    const upright = buoyancy(rest(n, n), heat, 10, UP, DT, false);
    expect(Math.abs(at(upright.x, centre, centre, false))).toBe(0);
  });

  it("weights each axis in its own cells on a grid that is not square", () => {
    const wide = buoyancy(rest(32, 16), blob(32, 16), 10, [1, 1], DT, false);
    const scale = projectionScale(32, 16);
    expect(at(wide.x, 16, 8, false) / at(wide.y, 16, 8, false)).toBeCloseTo(
      scale.toStoredX / scale.toStoredY,
      9,
    );
  });
});

const project = (u: Velocity, wrap: boolean, sweeps: number): Velocity => {
  const { width, height } = u.x;
  const scale = projectionScale(width, height);
  const wallValue = (f: Field, x: number, y: number, mirror: number): number =>
    wrap ? at(f, x, y, true) : mirror;
  const divergence = fieldFrom(width, height, (x, y) => {
    const centreX = at(u.x, x, y, wrap);
    const centreY = at(u.y, x, y, wrap);
    const left =
      x === 0 ? wallValue(u.x, x - 1, y, -centreX) : at(u.x, x - 1, y, wrap);
    const right =
      x === width - 1
        ? wallValue(u.x, x + 1, y, -centreX)
        : at(u.x, x + 1, y, wrap);
    const down =
      y === 0 ? wallValue(u.y, x, y - 1, -centreY) : at(u.y, x, y - 1, wrap);
    const above =
      y === height - 1
        ? wallValue(u.y, x, y + 1, -centreY)
        : at(u.y, x, y + 1, wrap);
    return (
      0.5 * scale.toCellsX * (right - left) +
      0.5 * scale.toCellsY * (above - down)
    );
  });
  let pressure = fieldFrom(width, height, () => 0);
  for (let i = 0; i < sweeps; i++) {
    const previous = pressure;
    pressure = fieldFrom(
      width,
      height,
      (x, y) =>
        (at(previous, x - 1, y, wrap) +
          at(previous, x + 1, y, wrap) +
          at(previous, x, y - 1, wrap) +
          at(previous, x, y + 1, wrap) -
          at(divergence, x, y, wrap)) *
        0.25,
    );
  }
  const wall = (id: number, size: number): boolean =>
    !wrap && (id === 0 || id === size - 1);
  return {
    x: fieldFrom(width, height, (x, y) =>
      wall(x, width)
        ? 0
        : at(u.x, x, y, wrap) -
          0.5 *
            scale.toStoredX *
            (at(pressure, x + 1, y, wrap) - at(pressure, x - 1, y, wrap)),
    ),
    y: fieldFrom(width, height, (x, y) =>
      wall(y, height)
        ? 0
        : at(u.y, x, y, wrap) -
          0.5 *
            scale.toStoredY *
            (at(pressure, x, y + 1, wrap) - at(pressure, x, y - 1, wrap)),
    ),
  };
};

describe("the lift through the projection", () => {
  const n = 16;
  const sweeps = 600;
  const centre = n / 2;
  const heat = blob(n, n);

  for (const wrap of [false, true]) {
    const edges = wrap ? "joined edges" : "walls";

    it(`still rises where the heat is, with ${edges}`, () => {
      const lifted = buoyancy(rest(n, n), heat, 10, UP, DT, wrap);
      const projected = project(lifted, wrap, sweeps);
      expect(along(projected, UP, centre, centre)).toBeGreaterThan(0);
    });

    it(`leaves a flow with no buoyancy at rest, with ${edges}`, () => {
      const lifted = buoyancy(rest(n, n), heat, 0, UP, DT, wrap);
      const projected = project(lifted, wrap, sweeps);
      expect(Math.max(...projected.y.data.map(Math.abs))).toBe(0);
    });

    it(`is linear in the strength, with ${edges}`, () => {
      const rise = (strength: number): number =>
        along(
          project(
            buoyancy(rest(n, n), heat, strength, UP, DT, wrap),
            wrap,
            sweeps,
          ),
          UP,
          centre,
          centre,
        );
      expect(rise(20)).toBeCloseTo(2 * rise(10), 9);
    });
  }
});

describe("the heat's decay", () => {
  const cool = (heat: number, rate: number, dt: number): number =>
    heat / (1 + rate * dt);

  it("returns the field to zero without injection at the default rate", () => {
    let heat = 1;
    for (let t = 0; t < 20; t += DT) heat = cool(heat, HEAT_COOLING, DT);
    expect(heat).toBeLessThan(1e-3);
  });

  it("shrinks every step for any positive rate", () => {
    expect(cool(1, 0.05, DT)).toBeLessThan(1);
  });
});

describe("the shader's side of it", () => {
  it("lifts along the uniform up direction by heat read from the dye's alpha", () => {
    expect(simulationShaderSource).toMatch(
      /let heat = sampleAt\(buoyancyDye, dyeSize, dyeCell\)\.a;/,
    );
    expect(simulationShaderSource).toMatch(
      /let force = u\.buoyancy \* heat \* u\.up;/,
    );
    expect(simulationShaderSource).toMatch(
      /let lifted = velocity \+ u\.toStored \* force \* u\.dt;/,
    );
  });

  it("decays the alpha channel by its own rate", () => {
    expect(simulationShaderSource).toMatch(
      /advectParams\.dissipation,\s*advectParams\.dissipation,\s*advectParams\.dissipation,\s*advectParams\.heatDissipation,/,
    );
  });

  it("adds a splat's heat into the alpha channel", () => {
    expect(simulationShaderSource).toMatch(
      /vec4f\(s\.color\.rgb \* falloff, s\.heat \* falloff\)/,
    );
  });

  it("keeps a default strength that does something", () => {
    expect(BUOYANCY_STRENGTH).toBeGreaterThan(0);
  });
});
