import { describe, expect, it } from "vitest";

import { PRESSURE_ITERATIONS, SIM_RESOLUTION } from "./config";
import { jacobiDiagonal, projectionScale } from "./projection";

/**
 * The discrete operators the projection passes implement, rebuilt here from
 * the factors `projection.ts` derives, so their identities can be checked
 * without a GPU. A wrong sign, a swapped axis, or a missing aspect term is
 * invisible to the Playwright suite — the fluid still looks like a fluid —
 * but breaks an assertion below.
 *
 * The operators are transcribed from `simulation.wgsl` by hand, so this checks
 * the derivation, not the shader: editing a projection pass means editing its
 * twin here.
 */

interface Field {
  readonly width: number;
  readonly height: number;
  readonly data: Float64Array;
}

const field = (width: number, height: number): Field => ({
  width,
  height,
  data: new Float64Array(width * height),
});

/** Reads outside the grid clamp to the edge, matching `loadAt`. */
const at = (f: Field, x: number, y: number): number => {
  const cx = Math.min(Math.max(x, 0), f.width - 1);
  const cy = Math.min(Math.max(y, 0), f.height - 1);
  return f.data[cy * f.width + cx] ?? 0;
};

const set = (f: Field, x: number, y: number, value: number): void => {
  f.data[y * f.width + x] = value;
};

interface Velocity {
  readonly x: Field;
  readonly y: Field;
}

const velocity = (width: number, height: number): Velocity => ({
  x: field(width, height),
  y: field(width, height),
});

/**
 * The `divergence` pass: a central difference per axis, each scaled into the
 * physical metric, with the outside sample mirrored at a wall so no flow
 * crosses it.
 */
const divergence = (u: Velocity, aspect: number): Field => {
  const { width, height } = u.x;
  const scale = projectionScale(width, height, aspect);
  const out = field(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const centreX = at(u.x, x, y);
      const centreY = at(u.y, x, y);

      const left = x === 0 ? -centreX : at(u.x, x - 1, y);
      const right = x === width - 1 ? -centreX : at(u.x, x + 1, y);
      const down = y === 0 ? -centreY : at(u.y, x, y - 1);
      const up = y === height - 1 ? -centreY : at(u.y, x, y + 1);

      set(
        out,
        x,
        y,
        0.5 * scale.divergenceX * (right - left) +
          0.5 * scale.divergenceY * (up - down),
      );
    }
  }
  return out;
};

/**
 * The pressure gradient `gradientSubtract` removes, as its own operator so the
 * adjoint identity can be checked against `divergence`.
 */
const gradient = (p: Field, aspect: number): Velocity => {
  const { width, height } = p;
  const scale = projectionScale(width, height, aspect);
  const out = velocity(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      set(
        out.x,
        x,
        y,
        0.5 * scale.gradientX * (at(p, x + 1, y) - at(p, x - 1, y)),
      );
      set(
        out.y,
        x,
        y,
        0.5 * scale.gradientY * (at(p, x, y + 1) - at(p, x, y - 1)),
      );
    }
  }
  return out;
};

/** The Laplacian the Jacobi sweep inverts, written out as an operator. */
const laplacian = (p: Field, aspect: number): Field => {
  const { width, height } = p;
  const scale = projectionScale(width, height, aspect);
  const diagonal = jacobiDiagonal(scale);
  const out = field(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      set(
        out,
        x,
        y,
        scale.laplacianX * (at(p, x + 1, y) + at(p, x - 1, y)) +
          scale.laplacianY * (at(p, x, y + 1) + at(p, x, y - 1)) -
          diagonal * at(p, x, y),
      );
    }
  }
  return out;
};

/** One Jacobi sweep, transcribed from the `pressure` entry point. */
const jacobiSweep = (p: Field, rhs: Field, aspect: number): Field => {
  const { width, height } = p;
  const scale = projectionScale(width, height, aspect);
  const diagonal = jacobiDiagonal(scale);
  const out = field(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const neighbours =
        scale.laplacianX * (at(p, x + 1, y) + at(p, x - 1, y)) +
        scale.laplacianY * (at(p, x, y + 1) + at(p, x, y - 1));
      set(out, x, y, (neighbours - at(rhs, x, y)) / diagonal);
    }
  }
  return out;
};

const solvePressure = (rhs: Field, aspect: number, sweeps: number): Field => {
  let p = field(rhs.width, rhs.height);
  for (let i = 0; i < sweeps; i++) p = jacobiSweep(p, rhs, aspect);
  return p;
};

/** Interior cells only: the walls carry the boundary condition, not the field. */
const l2Interior = (f: Field): number => {
  let sum = 0;
  for (let y = 1; y < f.height - 1; y++) {
    for (let x = 1; x < f.width - 1; x++) {
      const v = at(f, x, y);
      sum += v * v;
    }
  }
  return Math.sqrt(sum);
};

const fillVelocity = (
  u: Velocity,
  fx: (x: number, y: number) => number,
  fy: (x: number, y: number) => number,
): void => {
  for (let y = 0; y < u.x.height; y++) {
    for (let x = 0; x < u.x.width; x++) {
      set(u.x, x, y, fx(x, y));
      set(u.y, x, y, fy(x, y));
    }
  }
};

const fillField = (f: Field, fn: (x: number, y: number) => number): void => {
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) set(f, x, y, fn(x, y));
  }
};

describe("projectionScale", () => {
  it("weights the two axes equally when the cells are square", () => {
    // A 16:9 canvas on a 16:9 grid: the cells come out square, so neither axis
    // should be favoured even though the cell *counts* differ by 16/9.
    const scale = projectionScale(320, 180, 16 / 9);
    expect(scale.divergenceX).toBeCloseTo(scale.divergenceY, 6);
    expect(scale.laplacianX).toBeCloseTo(scale.laplacianY, 6);
  });

  it("weights the axes apart when the cells are not square", () => {
    // `fitGrid`'s two-cell floor produces this at extreme aspects, and it is
    // exactly the case a single shared cell size would get wrong.
    const scale = projectionScale(320, 2, 300);
    const cellX = 300 / 320;
    const cellY = 1 / 2;
    expect(scale.divergenceX / scale.divergenceY).toBeCloseTo(cellY / cellX, 6);
  });

  it("derives every factor from the same two cell sizes", () => {
    const scale = projectionScale(97, 41, 2.3);
    expect(scale.gradientX).toBeCloseTo(scale.divergenceX, 9);
    expect(scale.gradientY).toBeCloseTo(scale.divergenceY, 9);
    expect(scale.laplacianX).toBeCloseTo(scale.divergenceX ** 2, 9);
    expect(scale.laplacianY).toBeCloseTo(scale.divergenceY ** 2, 9);
  });

  it("scales as an inverse length", () => {
    const coarse = projectionScale(32, 18, 16 / 9);
    const fine = projectionScale(64, 36, 16 / 9);
    expect(fine.divergenceX / coarse.divergenceX).toBeCloseTo(2, 6);
    expect(fine.laplacianX / coarse.laplacianX).toBeCloseTo(4, 6);
  });
});

describe("jacobiDiagonal", () => {
  it("reduces to the textbook 4 / h² on a square grid", () => {
    // The uniform-cell solver hard-codes a 0.25 multiplier, i.e. a diagonal of
    // 4 in units where h = 1. The weighted form has to agree there.
    const scale = projectionScale(16, 16, 1);
    expect(jacobiDiagonal(scale)).toBeCloseTo(4 * 16 * 16, 6);
  });

  it("is the sum of the weights the sweep spreads over the neighbours", () => {
    const scale = projectionScale(40, 13, 3.1);
    expect(jacobiDiagonal(scale)).toBeCloseTo(
      2 * scale.laplacianX + 2 * scale.laplacianY,
      9,
    );
  });
});

describe("the discrete operators", () => {
  it("measures no divergence in a uniform flow", () => {
    const u = velocity(12, 7);
    fillVelocity(
      u,
      () => 0.4,
      () => -0.2,
    );
    // The walls do carry divergence — that is the free-slip condition biting,
    // not an error — so the interior is what must come out clean.
    expect(l2Interior(divergence(u, 16 / 9))).toBeCloseTo(0, 9);
  });

  it("measures a pure expansion as positive divergence", () => {
    const u = velocity(9, 9);
    fillVelocity(
      u,
      (x) => x,
      (_x, y) => y,
    );
    const d = divergence(u, 1);
    expect(at(d, 4, 4)).toBeGreaterThan(0);
  });

  it("measures the same divergence for a flow rotated by a quarter turn", () => {
    // The anisotropy of #681 shows up precisely here: before the per-axis
    // factors, the same physical flow read as different divergences depending
    // on which way it pointed.
    const aspect = 16 / 9;
    const width = 32;
    const height = 18;

    const horizontal = velocity(width, height);
    fillVelocity(
      horizontal,
      (x) => (x / width) * aspect,
      () => 0,
    );

    const vertical = velocity(width, height);
    fillVelocity(
      vertical,
      () => 0,
      (_x, y) => y / height,
    );

    const dH = divergence(horizontal, aspect);
    const dV = divergence(vertical, aspect);
    expect(at(dH, 16, 9)).toBeCloseTo(at(dV, 16, 9), 6);
  });

  it("does NOT compose into the Laplacian the Jacobi sweep inverts", () => {
    // #681's second defect, pinned as the gap it currently is: a central
    // difference on both sides composes to a 2-cell Laplacian, not the 1-cell
    // operator the sweep solves. Fixing the stencils flips this assertion.
    const aspect = 16 / 9;
    const p = field(24, 14);
    fillField(p, (x, y) => Math.sin(x * 0.3) * Math.cos(y * 0.45));

    const composed = divergence(gradient(p, aspect), aspect);
    const direct = laplacian(p, aspect);

    const difference = field(p.width, p.height);
    for (let i = 0; i < difference.data.length; i++) {
      difference.data[i] = (composed.data[i] ?? 0) - (direct.data[i] ?? 0);
    }
    expect(l2Interior(difference) / l2Interior(direct)).toBeGreaterThan(0.1);
  });
});

describe("the Jacobi sweep", () => {
  it("leaves the exact solution where it is", () => {
    const aspect = 16 / 9;
    const p = field(20, 12);
    fillField(p, (x, y) => Math.sin(x * 0.4) * Math.sin(y * 0.6));

    const rhs = laplacian(p, aspect);
    const swept = jacobiSweep(p, rhs, aspect);

    const difference = field(p.width, p.height);
    for (let i = 0; i < difference.data.length; i++) {
      difference.data[i] = (swept.data[i] ?? 0) - (p.data[i] ?? 0);
    }
    expect(l2Interior(difference) / l2Interior(p)).toBeLessThan(1e-9);
  });

  /** Sweep a starting error towards the zero solution and report what remains. */
  const surviving = (start: Field, aspect: number, sweeps: number): number => {
    const zero = field(start.width, start.height);
    let current = start;
    for (let i = 0; i < sweeps; i++)
      current = jacobiSweep(current, zero, aspect);
    return l2Interior(current) / l2Interior(start);
  };

  it("barely damps a checkerboard it is handed", () => {
    // The sweep amplifies by (cos kx + cos ky) / 2 — exactly -1 at (pi, pi) —
    // so a checkerboard survives every sweep and only the walls erode it, over
    // a distance the real grid does not give them.
    const error = field(SIM_RESOLUTION, 180);
    fillField(error, (x, y) => ((x + y) % 2 === 0 ? 1 : -1));

    expect(surviving(error, 16 / 9, PRESSURE_ITERATIONS)).toBeGreaterThan(0.95);
  });

  it("hides that on a grid small enough for the walls to reach", () => {
    // The same error decays by half on a 16x16 grid, so a test at a convenient
    // size reports the sweep as healthy. Pinned so the test above cannot be
    // quietly shrunk back into this regime.
    const error = field(16, 16);
    fillField(error, (x, y) => ((x + y) % 2 === 0 ? 1 : -1));

    expect(surviving(error, 1, PRESSURE_ITERATIONS)).toBeLessThan(0.6);
  });

  it("never raises a checkerboard the divergence did not contain", () => {
    // Why the mode above costs nothing in practice, and why a weighted sweep
    // would be the wrong fix: an amplification of -1 neither damps NOR grows
    // the mode, and the solve starts from zero — so with a smooth divergence
    // driving it, no checkerboard is ever created to need damping.
    const aspect = 16 / 9;
    const u = velocity(64, 36);
    fillVelocity(
      u,
      (x, y) => Math.sin(x * 0.2) * Math.cos(y * 0.15),
      (x, y) => Math.cos(x * 0.1) * Math.sin(y * 0.25),
    );

    const p = solvePressure(divergence(u, aspect), aspect, PRESSURE_ITERATIONS);

    // Project the pressure onto the (pi, pi) mode and compare with its overall
    // magnitude: a field carrying real checkerboard would score near 1.
    let alternating = 0;
    let cells = 0;
    for (let y = 1; y < p.height - 1; y++) {
      for (let x = 1; x < p.width - 1; x++) {
        alternating += at(p, x, y) * ((x + y) % 2 === 0 ? 1 : -1);
        cells++;
      }
    }
    const share = Math.abs(alternating) / Math.sqrt(cells) / l2Interior(p);
    expect(share).toBeLessThan(0.001);
  });

  it("damps a mid-frequency mode at the same resolution", () => {
    // Same grid and sweep count as the checkerboard test, so the contrast
    // isolates the frequency rather than the geometry.
    const error = field(SIM_RESOLUTION, 180);
    fillField(
      error,
      (x, y) => Math.sin((x * Math.PI) / 2) * Math.sin((y * Math.PI) / 2),
    );

    expect(surviving(error, 16 / 9, PRESSURE_ITERATIONS)).toBeLessThan(0.05);
  });
});

describe("the projection as a whole", () => {
  const project = (u: Velocity, aspect: number, sweeps: number): Velocity => {
    const rhs = divergence(u, aspect);
    const p = solvePressure(rhs, aspect, sweeps);
    const g = gradient(p, aspect);
    const out = velocity(u.x.width, u.x.height);
    fillVelocity(
      out,
      (x, y) => at(u.x, x, y) - at(g.x, x, y),
      (x, y) => at(u.y, x, y) - at(g.y, x, y),
    );
    return out;
  };

  it("reduces the divergence of a compressible flow", () => {
    const aspect = 16 / 9;
    const u = velocity(24, 14);
    fillVelocity(
      u,
      (x, y) => Math.sin(x * 0.5) * Math.cos(y * 0.3),
      (x, y) => Math.cos(x * 0.2) * Math.sin(y * 0.7),
    );

    const before = l2Interior(divergence(u, aspect));
    const after = l2Interior(divergence(project(u, aspect, 64), aspect));
    expect(after).toBeLessThan(before);
  });

  it("treats a flow and its quarter-turn rotation alike on a square grid", () => {
    // Rotational symmetry is the property the anisotropy destroyed. On a
    // square grid with a square canvas the projection must not care which axis
    // the flow runs along.
    const size = 16;
    const sweeps = 64;

    const horizontal = velocity(size, size);
    fillVelocity(
      horizontal,
      (x) => Math.sin(x * 0.4),
      () => 0,
    );

    const vertical = velocity(size, size);
    fillVelocity(
      vertical,
      () => 0,
      (_x, y) => Math.sin(y * 0.4),
    );

    const ph = solvePressure(divergence(horizontal, 1), 1, sweeps);
    const pv = solvePressure(divergence(vertical, 1), 1, sweeps);

    // The two pressure fields are each other's transpose if the operator has
    // no directional bias.
    let worst = 0;
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        worst = Math.max(worst, Math.abs(at(ph, x, y) - at(pv, y, x)));
      }
    }
    expect(worst / l2Interior(ph)).toBeLessThan(1e-9);
  });

  it("stays symmetric on a non-square canvas once the metric is carried", () => {
    // The regression #681 describes: with equal weights, stretching the canvas
    // made the same physical flow read as two different divergences depending
    // on which axis it ran along.
    const aspect = 2;
    const width = 32;
    const height = 16;

    // One ramp per axis, rising by the same physical amount over the same
    // physical distance — the x component is `aspect` times larger in
    // normalised units because the canvas is that much wider, and it spans
    // `aspect` times as many cells.
    const horizontal = velocity(width, height);
    fillVelocity(
      horizontal,
      (x) => (x / width) * aspect,
      () => 0,
    );

    const vertical = velocity(width, height);
    fillVelocity(
      vertical,
      () => 0,
      (_x, y) => y / height,
    );

    const dH = divergence(horizontal, aspect);
    const dV = divergence(vertical, aspect);

    // Sampled off the walls, where the free-slip mirroring dominates instead.
    expect(at(dH, 16, 8)).toBeCloseTo(at(dV, 16, 8), 9);
  });
});
