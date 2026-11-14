import { describe, expect, it } from "vitest";

import { gravityInCells } from "./lift";

describe("gravityInCells", () => {
  it("is the gravity divided by the cell's size in metres", () => {
    expect(gravityInCells(9.8, 3, 320)).toBeCloseTo(9.8 / (3 / 320), 10);
  });

  it("halves when the canvas is twice as long, which is slower motion", () => {
    expect(gravityInCells(9.8, 6, 320)).toBeCloseTo(
      gravityInCells(9.8, 3, 320) / 2,
      10,
    );
  });

  it("doubles with the gravity and keeps its sign", () => {
    expect(gravityInCells(19.6, 3, 320)).toBeCloseTo(
      2 * gravityInCells(9.8, 3, 320),
      10,
    );
    expect(gravityInCells(-9.8, 3, 320)).toBeLessThan(0);
    expect(gravityInCells(0, 3, 320)).toBe(0);
  });

  it("grows with the grid, so a finer grid keeps the same metres per second squared", () => {
    expect(gravityInCells(9.8, 3, 640)).toBeCloseTo(
      2 * gravityInCells(9.8, 3, 320),
      10,
    );
  });
});
