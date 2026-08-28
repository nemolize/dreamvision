import { describe, expect, it } from "vitest";

/**
 * The `resample` pass rebuilt on the CPU, from the same expressions
 * `simulation.wgsl` uses. A rebuild is the only thing that runs it, and a
 * rebuild that carried the field wrongly still looks like a fluid — a half-cell
 * slip or an inverted axis is invisible to the Playwright suite and breaks an
 * assertion below.
 *
 * Transcribed by hand, so this checks the mapping, not the shader: editing
 * `resample` or `sampleAt` means editing its twin here.
 */

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

const loadAt = (f: Field, x: number, y: number): number => {
  const cx = Math.min(Math.max(x, 0), f.width - 1);
  const cy = Math.min(Math.max(y, 0), f.height - 1);
  return f.data[cy * f.width + cx] ?? 0;
};

const sampleAt = (f: Field, x: number, y: number): number => {
  const baseX = Math.floor(x);
  const baseY = Math.floor(y);
  const fx = x - baseX;
  const fy = y - baseY;

  const c00 = loadAt(f, baseX, baseY);
  const c10 = loadAt(f, baseX + 1, baseY);
  const c01 = loadAt(f, baseX, baseY + 1);
  const c11 = loadAt(f, baseX + 1, baseY + 1);

  return (c00 + (c10 - c00) * fx) * (1 - fy) + (c01 + (c11 - c01) * fx) * fy;
};

const resample = (source: Field, width: number, height: number): Field =>
  fieldFrom(width, height, (x, y) =>
    sampleAt(
      source,
      ((x + 0.5) / width) * source.width - 0.5,
      ((y + 0.5) / height) * source.height - 0.5,
    ),
  );

describe("resample", () => {
  it("is the identity when the grids match", () => {
    const source = fieldFrom(7, 5, (x, y) => x * 10 + y);
    expect([...resample(source, 7, 5).data]).toEqual([...source.data]);
  });

  it("carries a constant field through both directions unchanged", () => {
    const source = fieldFrom(8, 6, () => 3.5);

    for (const value of resample(source, 20, 15).data) {
      expect(value).toBeCloseTo(3.5, 12);
    }
    for (const value of resample(source, 3, 2).data) {
      expect(value).toBeCloseTo(3.5, 12);
    }
  });

  it("keeps a linear ramp linear across an upscale, so the field does not shift", () => {
    const ramp = (cells: number, index: number): number =>
      (index + 0.5) / cells;
    const source = fieldFrom(8, 8, (x) => ramp(8, x));
    const carried = resample(source, 24, 8);

    for (let x = 0; x < 24; x++) {
      const expected = ramp(24, x);
      // The edge half-cells clamp rather than extrapolate, so only the interior
      // can reproduce the ramp exactly.
      if (expected < ramp(8, 0) || expected > ramp(8, 7)) continue;
      expect(carried.data[x]).toBeCloseTo(expected, 12);
    }
  });

  it("preserves which side a feature sits on, so neither axis flips", () => {
    const source = fieldFrom(8, 8, (x, y) => (x < 4 && y < 4 ? 1 : 0));
    const carried = resample(source, 16, 16);

    const at = (x: number, y: number): number => carried.data[y * 16 + x] ?? -1;
    expect(at(1, 1)).toBeCloseTo(1, 12);
    expect(at(14, 1)).toBeCloseTo(0, 12);
    expect(at(1, 14)).toBeCloseTo(0, 12);
  });
});
