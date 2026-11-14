// `at` and `sample` are the CPU twins of `loadAt` and `sampleAt` in `simulation.wgsl`.

export interface Field {
  readonly width: number;
  readonly height: number;
  readonly data: Float64Array;
}

export const fieldFrom = (
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

export const at = (f: Field, x: number, y: number, wrap = false): number => {
  const cx = wrap
    ? ((x % f.width) + f.width) % f.width
    : Math.min(Math.max(x, 0), f.width - 1);
  const cy = wrap
    ? ((y % f.height) + f.height) % f.height
    : Math.min(Math.max(y, 0), f.height - 1);
  return f.data[cy * f.width + cx] ?? 0;
};

export const sample = (
  f: Field,
  x: number,
  y: number,
  wrap = false,
): number => {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const fx = x - bx;
  const fy = y - by;
  const top = at(f, bx, by, wrap) * (1 - fx) + at(f, bx + 1, by, wrap) * fx;
  const bottom =
    at(f, bx, by + 1, wrap) * (1 - fx) + at(f, bx + 1, by + 1, wrap) * fx;
  return top * (1 - fy) + bottom * fy;
};
