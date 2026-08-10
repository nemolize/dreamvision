import { describe, expect, it } from "vitest";

import { PRESSURE_ITERATIONS, SIM_RESOLUTION } from "./config";
import { jacobiDiagonal, projectionScale } from "./projection";

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
        0.5 * scale.divergenceX * (right - left) +
          0.5 * scale.divergenceY * (up - down),
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

/** The Laplacian the Jacobi sweep inverts, written out as an operator. */
const laplacian = (p: Field): Field => {
  const { width, height } = p;
  const scale = projectionScale(width, height);
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
const jacobiSweep = (p: Field, rhs: Field): Field => {
  const { width, height } = p;
  const scale = projectionScale(width, height);
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
  it("weights each axis by its own cell count", () => {
    // What `advect` means by the stored units: one unit of vx crosses `width`
    // cells per second, one unit of vy crosses `height`. Equal weights — the
    // state before #681 — therefore under-count x by the aspect ratio.
    const scale = projectionScale(320, 180);
    expect(scale.divergenceX).toBe(320);
    expect(scale.divergenceY).toBe(180);
    expect(scale.divergenceY / scale.divergenceX).toBeCloseTo(180 / 320, 9);
  });

  it("weights the axes equally only on a square grid", () => {
    const scale = projectionScale(64, 64);
    expect(scale.divergenceX).toBe(scale.divergenceY);
    expect(scale.laplacianX).toBe(scale.laplacianY);
  });

  it("derives every factor from the same two cell counts", () => {
    const scale = projectionScale(97, 41);
    expect(scale.gradientX).toBe(scale.divergenceX);
    expect(scale.gradientY).toBe(scale.divergenceY);
    expect(scale.laplacianX).toBe(scale.divergenceX ** 2);
    expect(scale.laplacianY).toBe(scale.divergenceY ** 2);
  });

  it("scales as an inverse length", () => {
    const coarse = projectionScale(32, 18);
    const fine = projectionScale(64, 36);
    expect(fine.divergenceX / coarse.divergenceX).toBeCloseTo(2, 9);
    expect(fine.laplacianX / coarse.laplacianX).toBeCloseTo(4, 9);
  });
});

describe("jacobiDiagonal", () => {
  it("reduces to the textbook 4 / h² on a square grid", () => {
    // The uniform-cell solver hard-codes a 0.25 multiplier, i.e. a diagonal of
    // 4 in units where h = 1. The weighted form has to agree there.
    expect(jacobiDiagonal(projectionScale(16, 16))).toBeCloseTo(4 * 16 * 16, 9);
  });

  it("is the sum of the weights the sweep spreads over the neighbours", () => {
    const scale = projectionScale(40, 13);
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

  it("does NOT compose into the Laplacian the Jacobi sweep inverts", () => {
    // #681's second defect, pinned as the gap it currently is: a central
    // difference on both sides composes to a 2-cell Laplacian, not the 1-cell
    // operator the sweep solves. Fixing the stencils flips this assertion.
    const p = field(24, 14);
    fillField(p, (x, y) => Math.sin(x * 0.3) * Math.cos(y * 0.45));

    const composed = divergence(gradient(p));
    const direct = laplacian(p);

    const difference = field(p.width, p.height);
    for (let i = 0; i < difference.data.length; i++) {
      difference.data[i] = (composed.data[i] ?? 0) - (direct.data[i] ?? 0);
    }
    expect(l2Interior(difference) / l2Interior(direct)).toBeGreaterThan(0.1);
  });
});

describe("the Jacobi sweep", () => {
  it("leaves the exact solution where it is", () => {
    const p = field(20, 12);
    fillField(p, (x, y) => Math.sin(x * 0.4) * Math.sin(y * 0.6));

    const swept = jacobiSweep(p, laplacian(p));

    const difference = field(p.width, p.height);
    for (let i = 0; i < difference.data.length; i++) {
      difference.data[i] = (swept.data[i] ?? 0) - (p.data[i] ?? 0);
    }
    expect(l2Interior(difference) / l2Interior(p)).toBeLessThan(1e-9);
  });

  /** Sweep a starting error towards the zero solution and report what remains. */
  const surviving = (start: Field, sweeps: number): number => {
    const zero = field(start.width, start.height);
    let current = start;
    for (let i = 0; i < sweeps; i++) current = jacobiSweep(current, zero);
    return l2Interior(current) / l2Interior(start);
  };

  it("barely damps a checkerboard it is handed", () => {
    // The sweep amplifies by (cos kx + cos ky) / 2 — exactly -1 at (pi, pi) —
    // so a checkerboard survives every sweep and only the walls erode it, over
    // a distance the real grid does not give them.
    const error = field(SIM_RESOLUTION, 180);
    fillField(error, (x, y) => ((x + y) % 2 === 0 ? 1 : -1));

    expect(surviving(error, PRESSURE_ITERATIONS)).toBeGreaterThan(0.95);
  });

  it("hides that on a grid small enough for the walls to reach", () => {
    // The same error decays by half on a 16x16 grid, so a test at a convenient
    // size reports the sweep as healthy. Pinned so the test above cannot be
    // quietly shrunk back into this regime.
    const error = field(16, 16);
    fillField(error, (x, y) => ((x + y) % 2 === 0 ? 1 : -1));

    expect(surviving(error, PRESSURE_ITERATIONS)).toBeLessThan(0.6);
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
  /** The whole `gradientSubtract` pass, walls included. */
  const project = (u: Velocity, sweeps: number): Velocity => {
    const p = solvePressure(divergence(u), sweeps);
    const g = gradient(p);
    const subtracted = velocity(u.x.width, u.x.height);
    fillVelocity(
      subtracted,
      (x, y) => at(u.x, x, y) - at(g.x, x, y),
      (x, y) => at(u.y, x, y) - at(g.y, x, y),
    );
    return applyWalls(subtracted);
  };

  /** Net flow out through the four walls; a closed box must have none. */
  const wallFlux = (u: Velocity): number => {
    const { width, height } = u.x;
    let flux = 0;
    for (let y = 0; y < height; y++) {
      flux += at(u.x, width - 1, y) - at(u.x, 0, y);
    }
    for (let x = 0; x < width; x++) {
      flux += at(u.y, x, height - 1) - at(u.y, x, 0);
    }
    return flux;
  };

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

  it("lets no net flow through the walls", () => {
    // The box is closed, so whatever the interior does, the four edges must
    // carry nothing across. Negating the normal component — which is what the
    // pass did before — preserves its magnitude and only reverses the leak,
    // leaving this sum as large as it started.
    const u = velocity(64, 36);
    fillVelocity(
      u,
      (x, y) => Math.sin(x * 0.08) * Math.cos(y * 0.06),
      (x, y) => Math.cos(x * 0.05) * Math.sin(y * 0.09),
    );

    expect(Math.abs(wallFlux(project(u, 256)))).toBeCloseTo(0, 12);
  });

  it("leaves a flow sliding along a wall alone", () => {
    // Free-slip: the tangential component is not the projection's business, so
    // a flow parallel to an edge must survive the wall treatment untouched.
    const u = velocity(24, 14);
    fillVelocity(
      u,
      () => 0,
      () => 1,
    );

    const walled = applyWalls(u);
    // Down the left edge, `vy` is tangential and must be preserved...
    expect(at(walled.y, 0, 7)).toBe(1);
    // ...while on the top edge the same component is normal, and goes.
    expect(at(walled.y, 12, 0)).toBe(0);
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

  it("keeps that symmetry on a grid whose axes differ in resolution", () => {
    // The regression #681 describes. The same physical flow, once along each
    // axis, on a 2:1 grid: with equal weights the two projections disagreed by
    // the aspect ratio, and carrying the metric brings them back together.
    const width = 32;
    const height = 16;
    const sweeps = 256;

    const horizontal = velocity(width, height);
    fillVelocity(
      horizontal,
      (x) => Math.sin((x / width) * Math.PI),
      () => 0,
    );

    const vertical = velocity(width, height);
    fillVelocity(
      vertical,
      () => 0,
      (_x, y) => Math.sin((y / height) * Math.PI),
    );

    // Each flow's peak divergence, in the shared physical metric: the same
    // profile over the same fraction of the canvas either way.
    const peak = (f: Field): number => {
      let worst = 0;
      for (let y = 1; y < f.height - 1; y++) {
        for (let x = 1; x < f.width - 1; x++) {
          worst = Math.max(worst, Math.abs(at(f, x, y)));
        }
      }
      return worst;
    };

    const removedH =
      peak(divergence(horizontal)) -
      peak(divergence(project(horizontal, sweeps)));
    const removedV =
      peak(divergence(vertical)) - peak(divergence(project(vertical, sweeps)));
    expect(removedH / peak(divergence(horizontal))).toBeCloseTo(
      removedV / peak(divergence(vertical)),
      2,
    );
  });
});
