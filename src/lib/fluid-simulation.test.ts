import { describe, expect, it } from "vitest";

import { FluidSimulation } from "./fluid-simulation";

const WIDTH = 32;
const HEIGHT = 24;

const createSimulation = () => new FluidSimulation(WIDTH, HEIGHT);

const totalDensity = (simulation: FluidSimulation): number => {
  const { r, g, b } = simulation.getDensityArrays();
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    total += (r[i] ?? 0) + (g[i] ?? 0) + (b[i] ?? 0);
  }
  return total;
};

describe("FluidSimulation", () => {
  it("starts with zero density and velocity everywhere", () => {
    const simulation = createSimulation();

    expect(totalDensity(simulation)).toBe(0);
    expect(simulation.getRGBDensity(5, 5)).toEqual({ r: 0, g: 0, b: 0 });
    expect(simulation.getVelocity(5, 5)).toEqual({ x: 0, y: 0 });
  });

  it("accumulates density at the given cell", () => {
    const simulation = createSimulation();

    simulation.addDensity(10, 8, 100, 50, 25);
    simulation.addDensity(10, 8, 20, 10, 5);

    expect(simulation.getRGBDensity(10, 8)).toEqual({ r: 120, g: 60, b: 30 });
    expect(simulation.getRGBDensity(11, 8)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("accumulates velocity at the given cell", () => {
    const simulation = createSimulation();

    simulation.addVelocity(10, 8, 1.5, -2.5);
    simulation.addVelocity(10, 8, 0.5, 0.5);

    expect(simulation.getVelocity(10, 8)).toEqual({ x: 2, y: -2 });
  });

  it("clear resets all density and velocity fields", () => {
    const simulation = createSimulation();
    simulation.addDensity(10, 8, 255, 255, 255);
    simulation.addVelocity(10, 8, 5, 5);
    simulation.step();

    simulation.clear();

    expect(totalDensity(simulation)).toBe(0);
    expect(simulation.getVelocity(10, 8)).toEqual({ x: 0, y: 0 });
  });

  it("diffuses density into neighboring cells on step", () => {
    const simulation = createSimulation();
    simulation.addDensity(10, 8, 255, 255, 255);

    simulation.step();

    const neighbor = simulation.getRGBDensity(11, 8);
    expect(neighbor.r).toBeGreaterThan(0);
    expect(simulation.getRGBDensity(10, 8).r).toBeLessThan(255);
  });

  it("decays total density over time without new input", () => {
    const simulation = createSimulation();
    simulation.addDensity(10, 8, 255, 255, 255);

    simulation.step();
    const afterOneStep = totalDensity(simulation);
    for (let i = 0; i < 10; i++) {
      simulation.step();
    }

    expect(totalDensity(simulation)).toBeLessThan(afterOneStep);
  });

  it("keeps all fields finite under strong impulses", () => {
    const simulation = createSimulation();
    for (let i = 1; i <= WIDTH; i++) {
      simulation.addDensity(i, 5, 255, 255, 255);
      simulation.addVelocity(i, 5, 50, -50);
    }

    for (let i = 0; i < 20; i++) {
      simulation.step();
    }

    const { r, g, b } = simulation.getDensityArrays();
    const { x, y } = simulation.getVelocityArrays();
    for (const field of [r, g, b, x, y]) {
      for (let i = 0; i < field.length; i++) {
        expect(Number.isFinite(field[i] ?? 0)).toBe(true);
      }
    }
  });

  it("applies updated viscosity and diffusion without resetting state", () => {
    const simulation = createSimulation();
    simulation.addDensity(10, 8, 255, 255, 255);

    simulation.setViscosity(0.001);
    simulation.setDiffusion(0.001);

    expect(simulation.getRGBDensity(10, 8).r).toBe(255);
    simulation.step();
    expect(totalDensity(simulation)).toBeGreaterThan(0);
  });
});
