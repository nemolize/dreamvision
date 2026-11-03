import { describe, expect, it } from "vitest";

import { projectionScale } from "./projection";
import simulationShaderSource from "./simulation.wgsl?raw";

// CPU twin of the `curl` and `confine` passes, transcribed by hand: editing
// either pass in `simulation.wgsl` means editing its twin here.

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

interface Velocity {
  readonly x: Field;
  readonly y: Field;
}

const curl = (u: Velocity, wrap: boolean): Field => {
  const { width, height } = u.x;
  const scale = projectionScale(width, height);
  return fieldFrom(
    width,
    height,
    (x, y) =>
      0.5 *
      (scale.toCellsY * (at(u.y, x + 1, y, wrap) - at(u.y, x - 1, y, wrap)) -
        scale.toCellsX * (at(u.x, x, y + 1, wrap) - at(u.x, x, y - 1, wrap))),
  );
};

const GRADIENT_EPSILON = 1e-4;

const confine = (
  u: Velocity,
  strength: number,
  dt: number,
  wrap: boolean,
): Velocity => {
  const { width, height } = u.x;
  const scale = projectionScale(width, height);
  const curls = curl(u, wrap);

  const force = (x: number, y: number): [number, number] => {
    const centre = at(curls, x, y, wrap);
    const gradientX =
      0.5 *
      (Math.abs(at(curls, x + 1, y, wrap)) -
        Math.abs(at(curls, x - 1, y, wrap)));
    const gradientY =
      0.5 *
      (Math.abs(at(curls, x, y + 1, wrap)) -
        Math.abs(at(curls, x, y - 1, wrap)));
    const norm = Math.hypot(gradientX, gradientY) + GRADIENT_EPSILON;
    return [
      strength * centre * (gradientY / norm),
      strength * centre * -(gradientX / norm),
    ];
  };

  return {
    x: fieldFrom(
      width,
      height,
      (x, y) => at(u.x, x, y, wrap) + scale.toStoredX * force(x, y)[0] * dt,
    ),
    y: fieldFrom(
      width,
      height,
      (x, y) => at(u.y, x, y, wrap) + scale.toStoredY * force(x, y)[1] * dt,
    ),
  };
};

const vortex = (width: number, height: number, sense: number): Velocity => {
  const scale = projectionScale(width, height);
  const centreX = (width - 1) / 2;
  const centreY = (height - 1) / 2;
  const sigma = Math.min(width, height) / 5;
  const swirl = (x: number, y: number): number =>
    sense * Math.exp(-((x - centreX) ** 2 + (y - centreY) ** 2) / sigma ** 2);
  return {
    x: fieldFrom(
      width,
      height,
      (x, y) => (-(y - centreY) * swirl(x, y)) / scale.toCellsX,
    ),
    y: fieldFrom(
      width,
      height,
      (x, y) => ((x - centreX) * swirl(x, y)) / scale.toCellsY,
    ),
  };
};

const delta = (before: Field, after: Field): Float64Array =>
  after.data.map((value, index) => value - (before.data[index] ?? 0));

const alignment = (before: Velocity, after: Velocity): number => {
  const { width, height } = before.x;
  const scale = projectionScale(width, height);
  const dx = delta(before.x, after.x);
  const dy = delta(before.y, after.y);
  let total = 0;
  for (let index = 0; index < dx.length; index++) {
    total +=
      (dx[index] ?? 0) *
        scale.toCellsX *
        ((before.x.data[index] ?? 0) * scale.toCellsX) +
      (dy[index] ?? 0) *
        scale.toCellsY *
        ((before.y.data[index] ?? 0) * scale.toCellsY);
  }
  return total;
};

const interior = (f: Field, margin: number): number[] => {
  const cells: number[] = [];
  for (let y = margin; y < f.height - margin; y++) {
    for (let x = margin; x < f.width - margin; x++) {
      cells.push(f.data[y * f.width + x] ?? 0);
    }
  }
  return cells;
};

describe("the twin's guards", () => {
  it("names the epsilon the shader declares", () => {
    expect(simulationShaderSource).toMatch(
      new RegExp(
        `const GRADIENT_EPSILON: f32 = ${GRADIENT_EPSILON.toExponential()};`,
      ),
    );
  });
});

describe("curl", () => {
  it.each([
    [16, 16],
    [32, 8],
    [8, 32],
  ])(
    "measures a solid-body rotation in cells on a %i x %i grid",
    (width, height) => {
      const scale = projectionScale(width, height);
      const rate = 0.75;
      const rotation: Velocity = {
        x: fieldFrom(width, height, (_x, y) => (-rate * y) / scale.toCellsX),
        y: fieldFrom(width, height, (x) => (rate * x) / scale.toCellsY),
      };
      for (const value of interior(curl(rotation, false), 1)) {
        expect(value).toBeCloseTo(2 * rate, 9);
      }
    },
  );

  it("reads a uniform flow as curl-free", () => {
    const uniform: Velocity = {
      x: fieldFrom(12, 12, () => 0.3),
      y: fieldFrom(12, 12, () => -0.2),
    };
    for (const wrap of [false, true]) {
      for (const value of curl(uniform, wrap).data) expect(value).toBe(0);
    }
  });

  it("clamps at a wall and wraps at a joined edge", () => {
    const shear: Velocity = {
      x: fieldFrom(8, 8, () => 0),
      y: fieldFrom(8, 8, (x) => x),
    };
    expect(curl(shear, false).data[3 * 8]).toBeCloseTo(0.5 * 8 * 1, 9);
    expect(curl(shear, true).data[3 * 8]).toBeCloseTo(0.5 * 8 * (1 - 7), 9);
  });
});

describe("confine", () => {
  const dt = 1 / 60;

  it.each([1, -1])("speeds up a vortex turning with sense %i", (sense) => {
    const before = vortex(32, 32, sense);
    const after = confine(before, 20, dt, false);
    expect(alignment(before, after)).toBeGreaterThan(0);
  });

  it("adds nothing to a uniform flow", () => {
    const uniform: Velocity = {
      x: fieldFrom(12, 12, () => 0.3),
      y: fieldFrom(12, 12, () => -0.2),
    };
    for (const wrap of [false, true]) {
      const after = confine(uniform, 50, dt, wrap);
      expect(after.x.data).toStrictEqual(uniform.x.data);
      expect(after.y.data).toStrictEqual(uniform.y.data);
    }
  });

  it("adds nothing to an irrotational flow away from the walls", () => {
    const saddle: Velocity = {
      x: fieldFrom(16, 16, (x) => (x - 7.5) / 16),
      y: fieldFrom(16, 16, (_x, y) => -(y - 7.5) / 16),
    };
    const after = confine(saddle, 50, dt, false);
    const changed = delta(saddle.x, after.x).map(Math.abs);
    expect(Math.max(...interior({ ...saddle.x, data: changed }, 2))).toBe(0);
  });

  it("leaves the velocity alone at strength 0", () => {
    const before = vortex(24, 24, 1);
    const after = confine(before, 0, dt, false);
    expect(after.x.data).toStrictEqual(before.x.data);
    expect(after.y.data).toStrictEqual(before.y.data);
  });

  it("scales the change with the strength and with the step", () => {
    const before = vortex(24, 24, 1);
    const base = delta(before.x, confine(before, 10, dt, false).x);
    const doubled = delta(before.x, confine(before, 20, dt, false).x);
    const longer = delta(before.x, confine(before, 10, 2 * dt, false).x);
    base.forEach((value, index) => {
      expect(doubled[index]).toBeCloseTo(2 * value, 12);
      expect(longer[index]).toBeCloseTo(2 * value, 12);
    });
    expect(Math.max(...base.map(Math.abs))).toBeGreaterThan(0);
  });

  it("pushes equally hard in cells along both axes of a non-square grid", () => {
    const before = vortex(48, 16, 1);
    const after = confine(before, 20, dt, false);
    const scale = projectionScale(48, 16);
    const inCellsX = delta(before.x, after.x).map((v) =>
      Math.abs(v * scale.toCellsX),
    );
    const inCellsY = delta(before.y, after.y).map((v) =>
      Math.abs(v * scale.toCellsY),
    );
    const peakX = Math.max(...inCellsX);
    const peakY = Math.max(...inCellsY);
    expect(peakX).toBeGreaterThan(0);
    expect(peakX / peakY).toBeGreaterThan(0.5);
    expect(peakX / peakY).toBeLessThan(2);
  });

  it("is translation-invariant across joined edges, unlike a wall", () => {
    const width = 16;
    const height = 16;
    const source = vortex(width, height, 1);
    const shift = (f: Field): Field =>
      fieldFrom(width, height, (x, y) => at(f, x - 5, y - 3, true));
    const shifted: Velocity = { x: shift(source.x), y: shift(source.y) };

    const viaShift = confine(shifted, 20, dt, true);
    const shiftThen = confine(source, 20, dt, true);
    const expected = { x: shift(shiftThen.x), y: shift(shiftThen.y) };
    viaShift.x.data.forEach((value, index) => {
      expect(value).toBeCloseTo(expected.x.data[index] ?? 0, 12);
    });
    viaShift.y.data.forEach((value, index) => {
      expect(value).toBeCloseTo(expected.y.data[index] ?? 0, 12);
    });

    const wallShifted = confine(shifted, 20, dt, false);
    const wallExpected = confine(source, 20, dt, false);
    const differs = wallShifted.x.data.some(
      (value, index) =>
        Math.abs(value - (shift(wallExpected.x).data[index] ?? 0)) > 1e-9,
    );
    expect(differs).toBe(true);
  });
});
