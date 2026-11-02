import { describe, expect, it, vi } from "vitest";

import { MAX_FRAME_SECONDS, REFERENCE_STEP } from "./config";
import { FrameSchedule } from "./schedule";
import type { Splat } from "./types";

const splat = (x: number): Splat => ({
  x,
  y: 0.5,
  dx: 2,
  dy: -1,
  color: [1, 0.5, 0.25],
});

const sink = (produce: () => readonly Splat[] = () => [splat(0.5)]) => {
  const frames: { splats: readonly Splat[]; dt: number }[] = [];
  return {
    frames,
    consume: vi.fn(produce),
    frame: vi.fn((splats: readonly Splat[], dt: number) =>
      frames.push({ splats: [...splats], dt }),
    ),
  };
};

describe("FrameSchedule", () => {
  it("advances every frame by its own elapsed time", () => {
    const schedule = new FrameSchedule();
    const s = sink();

    expect(schedule.advance(1 / 120, s)).toBeCloseTo(1 / 120, 9);
    expect(schedule.advance(1 / 30, s)).toBeCloseTo(1 / 30, 9);

    expect(s.frames.map((f) => f.dt)).toEqual([1 / 120, 1 / 30]);
    expect(s.consume).toHaveBeenCalledTimes(2);
  });

  it("moves the fields half as far per frame when the display runs twice as fast", () => {
    const at60 = sink();
    const at120 = sink();

    new FrameSchedule().advance(1 / 60, at60);
    new FrameSchedule().advance(1 / 120, at120);

    expect(at120.frames[0]?.dt).toBeCloseTo((at60.frames[0]?.dt ?? 0) / 2, 9);
  });

  it("advances the same total time in a second at any refresh rate", () => {
    for (const hz of [30, 60, 75, 120, 144, 240, 360]) {
      const schedule = new FrameSchedule();
      const s = sink(() => []);

      for (let frame = 0; frame < hz; frame++) schedule.advance(1 / hz, s);

      const total = s.frames.reduce((sum, f) => sum + f.dt, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it("runs slower than real time below the frame-rate floor instead of taking a larger step", () => {
    const schedule = new FrameSchedule();
    const s = sink(() => []);

    for (let frame = 0; frame < 24; frame++) schedule.advance(1 / 24, s);

    expect(Math.max(...s.frames.map((f) => f.dt))).toBeCloseTo(
      MAX_FRAME_SECONDS,
      9,
    );
    expect(s.frames.reduce((sum, f) => sum + f.dt, 0)).toBeCloseTo(
      24 * MAX_FRAME_SECONDS,
      6,
    );
  });

  it("lays down the same dye per second at any refresh rate", () => {
    const dyePerSecond = (hz: number): number => {
      const schedule = new FrameSchedule();
      const s = sink();
      for (let frame = 0; frame < hz; frame++) schedule.advance(1 / hz, s);
      return s.frames.reduce(
        (sum, f) => sum + f.splats.reduce((n, p) => n + p.color[0], 0),
        0,
      );
    };

    const reference = dyePerSecond(60);
    for (const hz of [30, 120, 144, 240]) {
      expect(dyePerSecond(hz)).toBeCloseTo(reference, 6);
    }
  });

  it("scales the pointer's dye but not its displacement", () => {
    const schedule = new FrameSchedule();
    const s = sink();

    schedule.advance(REFERENCE_STEP / 2, s);

    expect(s.frames[0]?.splats).toEqual([
      { ...splat(0.5), color: [0.5, 0.25, 0.125] },
    ]);
  });

  it("caps a stall at one frame's ceiling, and the dye with it", () => {
    const schedule = new FrameSchedule();
    const s = sink();

    expect(schedule.advance(60, s)).toBeCloseTo(MAX_FRAME_SECONDS, 9);

    expect(s.frames[0]?.dt).toBeCloseTo(MAX_FRAME_SECONDS, 9);
    const gain = MAX_FRAME_SECONDS / REFERENCE_STEP;
    expect(s.frames[0]?.splats[0]?.color[0]).toBeCloseTo(gain, 9);
  });

  it("lands the seed burst unscaled in the first frame", () => {
    const seeds = [splat(0.1), splat(0.2)];
    const schedule = new FrameSchedule(seeds);
    const s = sink();

    schedule.advance(1 / 240, s);

    expect(s.frames[0]?.splats.slice(0, 2)).toEqual(seeds);
    expect(s.frames[0]?.splats).toHaveLength(3);
  });

  it("keeps the caller's seed array out of its own state", () => {
    const seeds = [splat(0.1)];
    const schedule = new FrameSchedule(seeds);
    seeds.push(splat(0.9));

    const s = sink(() => []);
    schedule.advance(REFERENCE_STEP, s);
    expect(s.frames[0]?.splats).toEqual([splat(0.1)]);
  });

  it("keeps the seed burst through frames that advance nothing", () => {
    const seeds = [splat(0.1), splat(0.2)];
    const schedule = new FrameSchedule(seeds);
    const s = sink(() => []);

    // A tab opened hidden skips every frame until it is shown, so the burst has
    // to survive however many empty frames precede the first one.
    expect(schedule.advance(0, s)).toBe(0);
    expect(schedule.advance(0, s)).toBe(0);
    expect(s.frame).not.toHaveBeenCalled();

    schedule.advance(REFERENCE_STEP, s);
    expect(s.frames[0]?.splats).toEqual(seeds);
  });

  it("skips a backwards frame without draining the pointer", () => {
    const schedule = new FrameSchedule();
    const s = sink();

    // Because Chromium was measured giving the first rAF callback a timestamp
    // before the performance.now() that seeded it.
    expect(schedule.advance(-4.3 / 1000, s)).toBe(0);
    expect(s.consume).not.toHaveBeenCalled();
    expect(schedule.advance(REFERENCE_STEP, s)).toBeCloseTo(REFERENCE_STEP, 9);
  });
});
