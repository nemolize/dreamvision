/**
 * 2D fluid solver based on Jos Stam's "Real-Time Fluid Dynamics for Games".
 *
 * The grid is (width + 2) x (height + 2): one ghost cell on each edge holds
 * the boundary condition. All fields are stored as flat Float64Array in
 * row-major order for cache locality in the per-frame solver loops.
 */

const LINEAR_SOLVE_ITERATIONS = 20;
const DEFAULT_VISCOSITY = 0.0001;
const DEFAULT_DIFFUSION = 0.0001;
const TIME_STEP = 0.1;
const DENSITY_DECAY = 0.995;

export class FluidSimulation {
  private readonly width: number;
  private readonly height: number;
  private readonly stride: number;
  private viscosity: number;
  private diffusion: number;

  private readonly densityR: Float64Array;
  private readonly densityG: Float64Array;
  private readonly densityB: Float64Array;
  private readonly prevDensityR: Float64Array;
  private readonly prevDensityG: Float64Array;
  private readonly prevDensityB: Float64Array;
  private readonly velocityX: Float64Array;
  private readonly velocityY: Float64Array;
  private readonly prevVelocityX: Float64Array;
  private readonly prevVelocityY: Float64Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.stride = width + 2;
    this.viscosity = DEFAULT_VISCOSITY;
    this.diffusion = DEFAULT_DIFFUSION;

    const size = (width + 2) * (height + 2);
    this.densityR = new Float64Array(size);
    this.densityG = new Float64Array(size);
    this.densityB = new Float64Array(size);
    this.prevDensityR = new Float64Array(size);
    this.prevDensityG = new Float64Array(size);
    this.prevDensityB = new Float64Array(size);
    this.velocityX = new Float64Array(size);
    this.velocityY = new Float64Array(size);
    this.prevVelocityX = new Float64Array(size);
    this.prevVelocityY = new Float64Array(size);
  }

  private index(x: number, y: number): number {
    return x + this.stride * y;
  }

  private setBoundary(boundary: number, x: Float64Array): void {
    const w = this.width;
    const h = this.height;
    const stride = this.stride;

    for (let i = 1; i <= w; i++) {
      const val1 = x[i + stride] ?? 0;
      const valH = x[i + stride * h] ?? 0;
      x[i] = boundary === 2 ? -val1 : val1;
      x[i + stride * (h + 1)] = boundary === 2 ? -valH : valH;
    }

    for (let j = 1; j <= h; j++) {
      const row = stride * j;
      const val1 = x[1 + row] ?? 0;
      const valW = x[w + row] ?? 0;
      x[row] = boundary === 1 ? -val1 : val1;
      x[w + 1 + row] = boundary === 1 ? -valW : valW;
    }

    x[this.index(0, 0)] =
      0.5 * ((x[this.index(1, 0)] ?? 0) + (x[this.index(0, 1)] ?? 0));
    x[this.index(0, h + 1)] =
      0.5 * ((x[this.index(1, h + 1)] ?? 0) + (x[this.index(0, h)] ?? 0));
    x[this.index(w + 1, 0)] =
      0.5 * ((x[this.index(w, 0)] ?? 0) + (x[this.index(w + 1, 1)] ?? 0));
    x[this.index(w + 1, h + 1)] =
      0.5 * ((x[this.index(w, h + 1)] ?? 0) + (x[this.index(w + 1, h)] ?? 0));
  }

  private linearSolve(
    boundary: number,
    x: Float64Array,
    x0: Float64Array,
    a: number,
    c: number,
  ): void {
    const stride = this.stride;
    const cRecip = 1.0 / c;

    for (let t = 0; t < LINEAR_SOLVE_ITERATIONS; t++) {
      for (let j = 1; j <= this.height; j++) {
        let idx = 1 + stride * j;
        for (let i = 1; i <= this.width; i++, idx++) {
          x[idx] =
            ((x0[idx] ?? 0) +
              a *
                ((x[idx + 1] ?? 0) +
                  (x[idx - 1] ?? 0) +
                  (x[idx + stride] ?? 0) +
                  (x[idx - stride] ?? 0))) *
            cRecip;
        }
      }
      this.setBoundary(boundary, x);
    }
  }

  private diffuse(
    boundary: number,
    x: Float64Array,
    x0: Float64Array,
    diff: number,
  ): void {
    const a = TIME_STEP * diff * this.width * this.height;
    this.linearSolve(boundary, x, x0, a, 1 + 4 * a);
  }

  private project(
    velocX: Float64Array,
    velocY: Float64Array,
    p: Float64Array,
    div: Float64Array,
  ): void {
    const w = this.width;
    const h = this.height;
    const stride = this.stride;

    for (let j = 1; j <= h; j++) {
      let idx = 1 + stride * j;
      for (let i = 1; i <= w; i++, idx++) {
        const vxRight = velocX[idx + 1] ?? 0;
        const vxLeft = velocX[idx - 1] ?? 0;
        const vyDown = velocY[idx + stride] ?? 0;
        const vyUp = velocY[idx - stride] ?? 0;

        div[idx] = (-0.5 * (vxRight - vxLeft + vyDown - vyUp)) / w;
        p[idx] = 0;
      }
    }

    this.setBoundary(0, div);
    this.setBoundary(0, p);
    this.linearSolve(0, p, div, 1, 4);

    for (let j = 1; j <= h; j++) {
      let idx = 1 + stride * j;
      for (let i = 1; i <= w; i++, idx++) {
        const pRight = p[idx + 1] ?? 0;
        const pLeft = p[idx - 1] ?? 0;
        const pDown = p[idx + stride] ?? 0;
        const pUp = p[idx - stride] ?? 0;

        velocX[idx] = (velocX[idx] ?? 0) - 0.5 * (pRight - pLeft) * w;
        velocY[idx] = (velocY[idx] ?? 0) - 0.5 * (pDown - pUp) * h;
      }
    }

    this.setBoundary(1, velocX);
    this.setBoundary(2, velocY);
  }

  private advect(
    boundary: number,
    d: Float64Array,
    d0: Float64Array,
    velocX: Float64Array,
    velocY: Float64Array,
  ): void {
    const w = this.width;
    const h = this.height;
    const stride = this.stride;
    const dtx = TIME_STEP * w;
    const dty = TIME_STEP * h;

    for (let j = 1; j <= h; j++) {
      let idx = 1 + stride * j;
      for (let i = 1; i <= w; i++, idx++) {
        // Trace the cell's value backwards along the velocity field, then
        // bilinearly interpolate between the four surrounding source cells.
        let x = i - dtx * (velocX[idx] ?? 0);
        let y = j - dty * (velocY[idx] ?? 0);

        if (x < 0.5) x = 0.5;
        if (x > w + 0.5) x = w + 0.5;
        const i0 = Math.floor(x);
        const i1 = i0 + 1;

        if (y < 0.5) y = 0.5;
        if (y > h + 0.5) y = h + 0.5;
        const j0 = Math.floor(y);
        const j1 = j0 + 1;

        const s1 = x - i0;
        const s0 = 1 - s1;
        const t1 = y - j0;
        const t0 = 1 - t1;

        const row0 = stride * j0;
        const row1 = stride * j1;
        const val00 = d0[i0 + row0] ?? 0;
        const val01 = d0[i0 + row1] ?? 0;
        const val10 = d0[i1 + row0] ?? 0;
        const val11 = d0[i1 + row1] ?? 0;

        d[idx] =
          s0 * (t0 * val00 + t1 * val01) + s1 * (t0 * val10 + t1 * val11);
      }
    }

    this.setBoundary(boundary, d);
  }

  addDensity(x: number, y: number, r: number, g: number, b: number): void {
    const idx = this.index(x, y);
    this.densityR[idx] = (this.densityR[idx] ?? 0) + r;
    this.densityG[idx] = (this.densityG[idx] ?? 0) + g;
    this.densityB[idx] = (this.densityB[idx] ?? 0) + b;
  }

  addVelocity(x: number, y: number, amountX: number, amountY: number): void {
    const idx = this.index(x, y);
    this.velocityX[idx] = (this.velocityX[idx] ?? 0) + amountX;
    this.velocityY[idx] = (this.velocityY[idx] ?? 0) + amountY;
  }

  step(): void {
    this.diffuse(1, this.prevVelocityX, this.velocityX, this.viscosity);
    this.diffuse(2, this.prevVelocityY, this.velocityY, this.viscosity);

    this.project(
      this.prevVelocityX,
      this.prevVelocityY,
      this.velocityX,
      this.velocityY,
    );

    this.advect(
      1,
      this.velocityX,
      this.prevVelocityX,
      this.prevVelocityX,
      this.prevVelocityY,
    );
    this.advect(
      2,
      this.velocityY,
      this.prevVelocityY,
      this.prevVelocityX,
      this.prevVelocityY,
    );

    this.project(
      this.velocityX,
      this.velocityY,
      this.prevVelocityX,
      this.prevVelocityY,
    );

    this.diffuse(0, this.prevDensityR, this.densityR, this.diffusion);
    this.diffuse(0, this.prevDensityG, this.densityG, this.diffusion);
    this.diffuse(0, this.prevDensityB, this.densityB, this.diffusion);

    this.advect(
      0,
      this.densityR,
      this.prevDensityR,
      this.velocityX,
      this.velocityY,
    );
    this.advect(
      0,
      this.densityG,
      this.prevDensityG,
      this.velocityX,
      this.velocityY,
    );
    this.advect(
      0,
      this.densityB,
      this.prevDensityB,
      this.velocityX,
      this.velocityY,
    );

    const { densityR, densityG, densityB } = this;
    for (let i = 0; i < densityR.length; i++) {
      densityR[i] = (densityR[i] ?? 0) * DENSITY_DECAY;
      densityG[i] = (densityG[i] ?? 0) * DENSITY_DECAY;
      densityB[i] = (densityB[i] ?? 0) * DENSITY_DECAY;
    }
  }

  getRGBDensity(x: number, y: number): { r: number; g: number; b: number } {
    const idx = this.index(x, y);
    return {
      r: this.densityR[idx] ?? 0,
      g: this.densityG[idx] ?? 0,
      b: this.densityB[idx] ?? 0,
    };
  }

  getVelocity(x: number, y: number): { x: number; y: number } {
    const idx = this.index(x, y);
    return {
      x: this.velocityX[idx] ?? 0,
      y: this.velocityY[idx] ?? 0,
    };
  }

  getDensityArrays(): { r: Float64Array; g: Float64Array; b: Float64Array } {
    return {
      r: this.densityR,
      g: this.densityG,
      b: this.densityB,
    };
  }

  getVelocityArrays(): { x: Float64Array; y: Float64Array } {
    return {
      x: this.velocityX,
      y: this.velocityY,
    };
  }

  setViscosity(viscosity: number): void {
    this.viscosity = viscosity;
  }

  setDiffusion(diffusion: number): void {
    this.diffusion = diffusion;
  }

  clear(): void {
    this.densityR.fill(0);
    this.densityG.fill(0);
    this.densityB.fill(0);
    this.prevDensityR.fill(0);
    this.prevDensityG.fill(0);
    this.prevDensityB.fill(0);
    this.velocityX.fill(0);
    this.velocityY.fill(0);
    this.prevVelocityX.fill(0);
    this.prevVelocityY.fill(0);
  }
}
