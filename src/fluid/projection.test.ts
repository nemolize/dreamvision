import { describe, expect, it } from "vitest";

import { PRESSURE_ITERATIONS, SIM_RESOLUTION } from "./config";
import { projectionScale, projectionUniform } from "./projection";

/**
 * The discrete operators the projection passes implement, rebuilt here from
 * the factors `projection.ts` derives, so their identities can be checked
 * without a GPU. A wrong sign, a swapped axis, or a missing per-axis weight is
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
 * The `divergence` pass: a central difference per axis, each weighted into the
 * cell metric, with the outside sample mirrored at a wall so no flow crosses
 * it.
 */
const divergence = (u: Velocity): Field => {
  const { width, height } = u.x;
  const scale = projectionScale(width, height);
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
        0.5 * scale.toCellsX * (right - left) +
          0.5 * scale.toCellsY * (up - down),
      );
    }
  }
  return out;
};

/**
 * The pressure gradient `gradientSubtract` removes, as its own operator so it
 * can be composed against `divergence`.
 */
const gradient = (p: Field): Velocity => {
  const { width, height } = p;
  const scale = projectionScale(width, height);
  const out = velocity(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      set(
        out.x,
        x,
        y,
        0.5 * scale.toStoredX * (at(p, x + 1, y) - at(p, x - 1, y)),
      );
      set(
        out.y,
        x,
        y,
        0.5 * scale.toStoredY * (at(p, x, y + 1) - at(p, x, y - 1)),
      );
    }
  }
  return out;
};

/**
 * `applyVelocityBoundary`: free-slip walls drop the component normal to the
 * edge and leave the tangential one alone.
 */
const applyWalls = (u: Velocity): Velocity => {
  const { width, height } = u.x;
  const out = velocity(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onVerticalWall = x === 0 || x === width - 1;
      const onHorizontalWall = y === 0 || y === height - 1;
      set(out.x, x, y, onVerticalWall ? 0 : at(u.x, x, y));
      set(out.y, x, y, onHorizontalWall ? 0 : at(u.y, x, y));
    }
  }
  return out;
};

const neighbourSum = (p: Field, x: number, y: number): number =>
  at(p, x + 1, y) + at(p, x - 1, y) + at(p, x, y + 1) + at(p, x, y - 1);

/** The Laplacian the Jacobi sweep inverts, written out as an operator. */
const laplacian = (p: Field): Field => {
  const out = field(p.width, p.height);
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      set(out, x, y, neighbourSum(p, x, y) - 4 * at(p, x, y));
    }
  }
  return out;
};

/** One Jacobi sweep, transcribed from the `pressure` entry point. */
const jacobiSweep = (p: Field, rhs: Field): Field => {
  const out = field(p.width, p.height);
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      set(out, x, y, (neighbourSum(p, x, y) - at(rhs, x, y)) * 0.25);
    }
  }
  return out;
};

const solvePressure = (rhs: Field, sweeps: number): Field => {
  let p = field(rhs.width, rhs.height);
  for (let i = 0; i < sweeps; i++) p = jacobiSweep(p, rhs);
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

/** `|a - b| / |b|` over the interior, for how closely two fields agree. */
const relativeDifference = (a: Field, b: Field): number => {
  const difference = field(a.width, a.height);
  for (let i = 0; i < difference.data.length; i++) {
    difference.data[i] = (a.data[i] ?? 0) - (b.data[i] ?? 0);
  }
  return l2Interior(difference) / l2Interior(b);
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
  it("converts each axis by its own cell count", () => {
    // What `advect` means by the stored units: one unit of vx crosses `width`
    // cells per second, one unit of vy crosses `height`. Equal weights — the
    // state before #681 — therefore under-count x by the aspect ratio.
    const scale = projectionScale(320, 180);
    expect(scale.toCellsX).toBe(320);
    expect(scale.toCellsY).toBe(180);
  });

  it("makes the two directions reciprocal", () => {
    // The way out has to undo the way in; see `projection.ts` for why.
    const scale = projectionScale(97, 41);
    expect(scale.toCellsX * scale.toStoredX).toBeCloseTo(1, 12);
    expect(scale.toCellsY * scale.toStoredY).toBeCloseTo(1, 12);
  });

  it("treats the axes alike only on a square grid", () => {
    const square = projectionScale(64, 64);
    expect(square.toCellsX).toBe(square.toCellsY);

    const oblong = projectionScale(64, 32);
    expect(oblong.toCellsX / oblong.toCellsY).toBe(2);
  });

  it("packs each conversion into the uniform slot the shader reads it from", () => {
    // Literals, not the record's own fields: a swap here reverses the metric on
    // the GPU and reads as a valid one everywhere else.
    const uniform = projectionUniform(projectionScale(64, 32));
    expect(uniform.toCells).toEqual([64, 32]);
    expect(uniform.toStored).toEqual([1 / 64, 1 / 32]);
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
    expect(l2Interior(divergence(u))).toBeCloseTo(0, 9);
  });

  it("measures a pure expansion as positive divergence", () => {
    const u = velocity(9, 9);
    fillVelocity(
      u,
      (x) => x,
      (_x, y) => y,
    );
    expect(at(divergence(u), 4, 4)).toBeGreaterThan(0);
  });

  it("reads the same divergence from a flow and its quarter turn", () => {
    // #681's anisotropy, as a symmetry: two flows that spread at the same
    // physical rate, one along each axis. In the stored units a full traverse
    // is 1.0 either way, so the same normalised ramp *is* the same physical
    // flow — and only the per-axis weights make the two readings agree.
    const width = 32;
    const height = 18;

    const horizontal = velocity(width, height);
    fillVelocity(
      horizontal,
      (x) => x / width,
      () => 0,
    );

    const vertical = velocity(width, height);
    fillVelocity(
      vertical,
      () => 0,
      (_x, y) => y / height,
    );

    expect(at(divergence(horizontal), 16, 9)).toBeCloseTo(
      at(divergence(vertical), 16, 9),
      9,
    );
  });

  it("drops the normal component at each wall and keeps the tangential one", () => {
    // Both axes, since the two edges are handled by separate branches: a
    // regression in one of them leaves the other's assertions passing.
    const width = 24;
    const height = 14;
    const u = velocity(width, height);
    fillVelocity(
      u,
      () => 1,
      () => 1,
    );

    const walled = applyWalls(u);

    // Left and right edges: `vx` crosses them, `vy` runs along them.
    for (const x of [0, width - 1]) {
      expect(at(walled.x, x, 7)).toBe(0);
      expect(at(walled.y, x, 7)).toBe(1);
    }

    // Top and bottom edges: the roles swap.
    for (const y of [0, height - 1]) {
      expect(at(walled.y, 12, y)).toBe(0);
      expect(at(walled.x, 12, y)).toBe(1);
    }

    // An interior cell keeps both.
    expect(at(walled.x, 12, 7)).toBe(1);
    expect(at(walled.y, 12, 7)).toBe(1);
  });

  it("converts the correction back to stored units, not into cells", () => {
    // A unit ramp differentiates to 1 per cell; one stored unit of vx spans 40
    // cells here, so the correction is 1/40. Reversing it gives 40. The literal
    // is deliberate — asserting against `projectionScale` would pass either way.
    const p = field(40, 10);
    fillField(p, (x) => x);

    const g = gradient(p);
    expect(at(g.x, 20, 5)).toBeCloseTo(1 / 40, 12);
    expect(at(g.y, 20, 5)).toBeCloseTo(0, 12);
  });

  it("does NOT compose into the Laplacian the Jacobi sweep inverts", () => {
    // #681's second defect, pinned as the gap it currently is: a central
    // difference on both sides composes to a 2-cell Laplacian, not the 1-cell
    // operator the sweep solves. Fixing the stencils flips this assertion.
    const p = field(24, 14);
    fillField(p, (x, y) => Math.sin(x * 0.3) * Math.cos(y * 0.45));

    expect(
      relativeDifference(divergence(gradient(p)), laplacian(p)),
    ).toBeGreaterThan(0.1);
  });
});

describe("the Jacobi sweep", () => {
  it("leaves the exact solution where it is", () => {
    const p = field(20, 12);
    fillField(p, (x, y) => Math.sin(x * 0.4) * Math.sin(y * 0.6));

    expect(relativeDifference(jacobiSweep(p, laplacian(p)), p)).toBeLessThan(
      1e-9,
    );
  });

  /** Sweep a starting error towards the zero solution and report what remains. */
  const surviving = (start: Field, sweeps: number): number => {
    const zero = field(start.width, start.height);
    let current = start;
    for (let i = 0; i < sweeps; i++) current = jacobiSweep(current, zero);
    return l2Interior(current) / l2Interior(start);
  };

  const checkerboard = (width: number, height: number): Field => {
    const f = field(width, height);
    fillField(f, (x, y) => ((x + y) % 2 === 0 ? 1 : -1));
    return f;
  };

  it("barely damps a checkerboard it is handed", () => {
    // The sweep amplifies by (cos kx + cos ky) / 2 — exactly -1 at (pi, pi) —
    // so a checkerboard survives every sweep and only the walls erode it, over
    // a distance a full-size grid does not give them.
    expect(
      surviving(
        checkerboard(SIM_RESOLUTION, Math.round(SIM_RESOLUTION / 2)),
        PRESSURE_ITERATIONS,
      ),
    ).toBeGreaterThan(0.95);
  });

  it("hides that on a grid small enough for the walls to reach", () => {
    // The same error decays by half on a 16x16 grid, so a test at a convenient
    // size reports the sweep as healthy. Pinned so the test above cannot be
    // quietly shrunk back into this regime.
    expect(surviving(checkerboard(16, 16), PRESSURE_ITERATIONS)).toBeLessThan(
      0.6,
    );
  });

  it("never raises a checkerboard the divergence did not contain", () => {
    // Why the mode above costs nothing in practice, and why a weighted sweep
    // would be the wrong fix: an amplification of -1 neither damps NOR grows
    // the mode, and the solve starts from zero — so a smooth divergence never
    // creates a checkerboard that would need damping.
    const u = velocity(64, 36);
    fillVelocity(
      u,
      (x, y) => Math.sin(x * 0.2) * Math.cos(y * 0.15),
      (x, y) => Math.cos(x * 0.1) * Math.sin(y * 0.25),
    );

    const p = solvePressure(divergence(u), PRESSURE_ITERATIONS);

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
});

describe("the projection as a whole", () => {
  /** Solve and subtract, stopping short of the wall pass. */
  const projectWithoutWalls = (u: Velocity, sweeps: number): Velocity => {
    const g = gradient(solvePressure(divergence(u), sweeps));
    const out = velocity(u.x.width, u.x.height);
    fillVelocity(
      out,
      (x, y) => at(u.x, x, y) - at(g.x, x, y),
      (x, y) => at(u.y, x, y) - at(g.y, x, y),
    );
    return out;
  };

  /** The whole `gradientSubtract` pass. */
  const project = (u: Velocity, sweeps: number): Velocity =>
    applyWalls(projectWithoutWalls(u, sweeps));

  it("reduces the divergence of a compressible flow", () => {
    const u = velocity(24, 14);
    fillVelocity(
      u,
      (x, y) => Math.sin(x * 0.5) * Math.cos(y * 0.3),
      (x, y) => Math.cos(x * 0.2) * Math.sin(y * 0.7),
    );

    const before = l2Interior(divergence(u));
    const after = l2Interior(divergence(project(u, 256)));
    expect(after).toBeLessThan(before);
  });

  it("leaves less divergence behind for dropping the wall's normal flow", () => {
    // Asserting the walls carry no flow would be a tautology — the pass just
    // zeroed those cells. What is worth checking is that doing so leaves the
    // field closer to divergence-free than not touching them at all.
    const u = velocity(64, 36);
    fillVelocity(
      u,
      (x, y) => Math.sin(x * 0.08) * Math.cos(y * 0.06),
      (x, y) => Math.cos(x * 0.05) * Math.sin(y * 0.09),
    );

    const withWalls = l2Interior(divergence(project(u, 256)));
    const without = l2Interior(divergence(projectWithoutWalls(u, 256)));
    expect(withWalls).toBeLessThan(without);
  });

  it("treats a flow and its quarter-turn rotation alike on a square grid", () => {
    // Rotational symmetry is the property the anisotropy destroyed. On a square
    // grid the projection must not care which axis the flow runs along, and the
    // two pressure fields must come out as each other's transpose.
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

    const ph = solvePressure(divergence(horizontal), sweeps);
    const pv = solvePressure(divergence(vertical), sweeps);

    let worst = 0;
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        worst = Math.max(worst, Math.abs(at(ph, x, y) - at(pv, y, x)));
      }
    }
    expect(worst / l2Interior(ph)).toBeLessThan(1e-9);
  });

  it("annihilates a curl-free flow on a grid whose axes differ", () => {
    // A pure gradient field is all divergence and no rotation, so a projection
    // that inverts its own operator takes it to nothing. This is the test that
    // catches a conversion applied in the wrong direction: how much divergence
    // a pass removes is invariant to that error, but how much of a removable
    // field actually survives is not.
    const width = 64;
    const height = 32;

    const potential = field(width, height);
    fillField(
      potential,
      (x, y) => Math.sin((x / width) * 3) * Math.cos((y / height) * 3),
    );
    const curlFree = gradient(potential);

    const projected = project(curlFree, 4096);

    let remaining = 0;
    let original = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        remaining += at(projected.x, x, y) ** 2 + at(projected.y, x, y) ** 2;
        original += at(curlFree.x, x, y) ** 2 + at(curlFree.y, x, y) ** 2;
      }
    }
    // The residual floor is the deferred stencil mismatch, not the metric:
    // weighting both directions alike leaves ~2.2% here against ~0.9%.
    expect(Math.sqrt(remaining / original)).toBeLessThan(0.015);
  });
});
