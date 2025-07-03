export class FluidSimulation {
  private width: number;
  private height: number;
  private viscosity: number;
  private diffusion: number;
  private dt: number;

  private density: number[];
  private prevDensity: number[];
  private velocityX: number[];
  private velocityY: number[];
  private prevVelocityX: number[];
  private prevVelocityY: number[];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.viscosity = 0.0001;
    this.diffusion = 0.0001;
    this.dt = 0.1;

    const size = (width + 2) * (height + 2);
    this.density = new Array(size).fill(0);
    this.prevDensity = new Array(size).fill(0);
    this.velocityX = new Array(size).fill(0);
    this.velocityY = new Array(size).fill(0);
    this.prevVelocityX = new Array(size).fill(0);
    this.prevVelocityY = new Array(size).fill(0);
  }

  private index(x: number, y: number): number {
    return x + (this.width + 2) * y;
  }

  private getArrayValue(arr: number[], index: number): number {
    return arr[index] ?? 0;
  }

  private setArrayValue(arr: number[], index: number, value: number): void {
    arr[index] = value;
  }

  private setBoundary(boundary: number, x: number[]): void {
    const w = this.width;
    const h = this.height;

    for (let i = 1; i <= w; i++) {
      const val1 = this.getArrayValue(x, this.index(i, 1));
      const valH = this.getArrayValue(x, this.index(i, h));
      this.setArrayValue(x, this.index(i, 0), boundary === 2 ? -val1 : val1);
      this.setArrayValue(
        x,
        this.index(i, h + 1),
        boundary === 2 ? -valH : valH,
      );
    }

    for (let j = 1; j <= h; j++) {
      const val1 = this.getArrayValue(x, this.index(1, j));
      const valW = this.getArrayValue(x, this.index(w, j));
      this.setArrayValue(x, this.index(0, j), boundary === 1 ? -val1 : val1);
      this.setArrayValue(
        x,
        this.index(w + 1, j),
        boundary === 1 ? -valW : valW,
      );
    }

    this.setArrayValue(
      x,
      this.index(0, 0),
      0.5 *
        (this.getArrayValue(x, this.index(1, 0)) +
          this.getArrayValue(x, this.index(0, 1))),
    );
    this.setArrayValue(
      x,
      this.index(0, h + 1),
      0.5 *
        (this.getArrayValue(x, this.index(1, h + 1)) +
          this.getArrayValue(x, this.index(0, h))),
    );
    this.setArrayValue(
      x,
      this.index(w + 1, 0),
      0.5 *
        (this.getArrayValue(x, this.index(w, 0)) +
          this.getArrayValue(x, this.index(w + 1, 1))),
    );
    this.setArrayValue(
      x,
      this.index(w + 1, h + 1),
      0.5 *
        (this.getArrayValue(x, this.index(w, h + 1)) +
          this.getArrayValue(x, this.index(w + 1, h))),
    );
  }

  private linearSolve(
    boundary: number,
    x: number[],
    x0: number[],
    a: number,
    c: number,
  ): void {
    const cRecip = 1.0 / c;
    for (let t = 0; t < 20; t++) {
      for (let j = 1; j <= this.height; j++) {
        for (let i = 1; i <= this.width; i++) {
          const idx = this.index(i, j);
          const x0Val = this.getArrayValue(x0, idx);
          const xRight = this.getArrayValue(x, this.index(i + 1, j));
          const xLeft = this.getArrayValue(x, this.index(i - 1, j));
          const xDown = this.getArrayValue(x, this.index(i, j + 1));
          const xUp = this.getArrayValue(x, this.index(i, j - 1));

          this.setArrayValue(
            x,
            idx,
            (x0Val + a * (xRight + xLeft + xDown + xUp)) * cRecip,
          );
        }
      }
      this.setBoundary(boundary, x);
    }
  }

  private diffuse(
    boundary: number,
    x: number[],
    x0: number[],
    diff: number,
  ): void {
    const a = this.dt * diff * this.width * this.height;
    this.linearSolve(boundary, x, x0, a, 1 + 4 * a);
  }

  private project(
    velocX: number[],
    velocY: number[],
    p: number[],
    div: number[],
  ): void {
    const w = this.width;
    const h = this.height;

    for (let j = 1; j <= h; j++) {
      for (let i = 1; i <= w; i++) {
        const idx = this.index(i, j);
        const vxRight = this.getArrayValue(velocX, this.index(i + 1, j));
        const vxLeft = this.getArrayValue(velocX, this.index(i - 1, j));
        const vyDown = this.getArrayValue(velocY, this.index(i, j + 1));
        const vyUp = this.getArrayValue(velocY, this.index(i, j - 1));

        this.setArrayValue(
          div,
          idx,
          (-0.5 * (vxRight - vxLeft + vyDown - vyUp)) / w,
        );
        this.setArrayValue(p, idx, 0);
      }
    }

    this.setBoundary(0, div);
    this.setBoundary(0, p);
    this.linearSolve(0, p, div, 1, 4);

    for (let j = 1; j <= h; j++) {
      for (let i = 1; i <= w; i++) {
        const idx = this.index(i, j);
        const pRight = this.getArrayValue(p, this.index(i + 1, j));
        const pLeft = this.getArrayValue(p, this.index(i - 1, j));
        const pDown = this.getArrayValue(p, this.index(i, j + 1));
        const pUp = this.getArrayValue(p, this.index(i, j - 1));

        const currentVx = this.getArrayValue(velocX, idx);
        const currentVy = this.getArrayValue(velocY, idx);

        this.setArrayValue(velocX, idx, currentVx - 0.5 * (pRight - pLeft) * w);
        this.setArrayValue(velocY, idx, currentVy - 0.5 * (pDown - pUp) * h);
      }
    }

    this.setBoundary(1, velocX);
    this.setBoundary(2, velocY);
  }

  private advect(
    boundary: number,
    d: number[],
    d0: number[],
    velocX: number[],
    velocY: number[],
  ): void {
    const w = this.width;
    const h = this.height;
    const dtx = this.dt * w;
    const dty = this.dt * h;

    for (let j = 1; j <= h; j++) {
      for (let i = 1; i <= w; i++) {
        const idx = this.index(i, j);
        const tmp1 = dtx * this.getArrayValue(velocX, idx);
        const tmp2 = dty * this.getArrayValue(velocY, idx);
        let x = i - tmp1;
        let y = j - tmp2;

        if (x < 0.5) x = 0.5;
        if (x > w + 0.5) x = w + 0.5;
        const i0 = Math.floor(x);
        const i1 = i0 + 1.0;

        if (y < 0.5) y = 0.5;
        if (y > h + 0.5) y = h + 0.5;
        const j0 = Math.floor(y);
        const j1 = j0 + 1.0;

        const s1 = x - i0;
        const s0 = 1.0 - s1;
        const t1 = y - j0;
        const t0 = 1.0 - t1;

        const i0i = Math.floor(i0);
        const i1i = Math.floor(i1);
        const j0i = Math.floor(j0);
        const j1i = Math.floor(j1);

        const val00 = this.getArrayValue(d0, this.index(i0i, j0i));
        const val01 = this.getArrayValue(d0, this.index(i0i, j1i));
        const val10 = this.getArrayValue(d0, this.index(i1i, j0i));
        const val11 = this.getArrayValue(d0, this.index(i1i, j1i));

        this.setArrayValue(
          d,
          idx,
          s0 * (t0 * val00 + t1 * val01) + s1 * (t0 * val10 + t1 * val11),
        );
      }
    }

    this.setBoundary(boundary, d);
  }

  addDensity(x: number, y: number, amount: number): void {
    const idx = this.index(x, y);
    const current = this.getArrayValue(this.density, idx);
    this.setArrayValue(this.density, idx, current + amount);
  }

  addVelocity(x: number, y: number, amountX: number, amountY: number): void {
    const idx = this.index(x, y);
    const currentX = this.getArrayValue(this.velocityX, idx);
    const currentY = this.getArrayValue(this.velocityY, idx);
    this.setArrayValue(this.velocityX, idx, currentX + amountX);
    this.setArrayValue(this.velocityY, idx, currentY + amountY);
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

    this.diffuse(0, this.prevDensity, this.density, this.diffusion);
    this.advect(
      0,
      this.density,
      this.prevDensity,
      this.velocityX,
      this.velocityY,
    );
  }

  getDensity(x: number, y: number): number {
    return this.getArrayValue(this.density, this.index(x, y));
  }

  getVelocity(x: number, y: number): { x: number; y: number } {
    const idx = this.index(x, y);
    return {
      x: this.getArrayValue(this.velocityX, idx),
      y: this.getArrayValue(this.velocityY, idx),
    };
  }

  getDensityArray(): number[] {
    return this.density;
  }

  getVelocityArrays(): { x: number[]; y: number[] } {
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
    this.density.fill(0);
    this.prevDensity.fill(0);
    this.velocityX.fill(0);
    this.velocityY.fill(0);
    this.prevVelocityX.fill(0);
    this.prevVelocityY.fill(0);
  }
}
