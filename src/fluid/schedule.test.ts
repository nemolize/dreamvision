import { describe, expect, it, vi } from "vitest";

import { MAX_STEPS_PER_FRAME, TIME_STEP } from "./config";
import { FrameSchedule } from "./schedule";
import type { Splat } from "./types";

const splat = (x: number): Splat => ({
  x,
  y: 0.5,
  dx: 0,
  dy: 0,
  color: [1, 1, 1],
});

const sink = (produce: () => readonly Splat[] = () => [splat(0.5)]) => {
  const frames: (readonly Splat[])[] = [];
  return {
    frames,
    consume: vi.fn(produce),
    frame: vi.fn((splats: readonly Splat[]) => frames.push([...splats])),
  };
};

describe("FrameSchedule", () => {
  it("runs no step, and drains nothing, until a step's worth of time accrues", () => {
    const schedule = new FrameSchedule();
    const s = sink();

    expect(schedule.advance(TIME_STEP / 2, s)).toBe(0);
    expect(s.consume).not.toHaveBeenCalled();
    expect(s.frame).not.toHaveBeenCalled();
  });

  it("drains once when two half-steps add up, not once per frame", () => {
    const schedule = new FrameSchedule();
    const s = sink();

    schedule.advance(TIME_STEP / 2, s);
    expect(schedule.advance(TIME_STEP / 2, s)).toBe(1);

    expect(s.consume).toHaveBeenCalledTimes(1);
    expect(s.frames).toEqual([[splat(0.5)]]);
  });

  it("holds the drain across a long stepless run rather than accruing per frame", () => {
    const schedule = new FrameSchedule();
    const s = sink();

    // Because 360Hz was measured running five stepless frames between steps,
    // each of which used to add a splat per pointer toward the silent cap.
    for (let frame = 0; frame < 5; frame++) schedule.advance(1 / 360, s);
    expect(s.consume).not.toHaveBeenCalled();

    schedule.advance(1 / 360, s);
    expect(s.consume).toHaveBeenCalledTimes(1);
    expect(s.frames.at(0)).toHaveLength(1);
  });

  it("gives the splats to the first catch-up step and nothing to the rest", () => {
    const schedule = new FrameSchedule();
    const s = sink();

    expect(schedule.advance(TIME_STEP * MAX_STEPS_PER_FRAME, s)).toBe(
      MAX_STEPS_PER_FRAME,
    );

    expect(s.consume).toHaveBeenCalledTimes(1);
    expect(s.frames).toEqual([[splat(0.5)], [], [], []]);
  });

  it("caps a stall at what one frame can drain", () => {
    const schedule = new FrameSchedule();
    const s = sink();

    expect(schedule.advance(60, s)).toBe(MAX_STEPS_PER_FRAME);
  });

  it("lands the seed burst inside the first step rather than dropping it", () => {
    const seeds = [splat(0.1), splat(0.2)];
    const schedule = new FrameSchedule(seeds);
    const s = sink();

    schedule.advance(TIME_STEP / 2, s);
    expect(s.frame).not.toHaveBeenCalled();

    schedule.advance(TIME_STEP / 2, s);
    expect(s.frames).toEqual([[...seeds, splat(0.5)]]);
  });

  it("keeps the caller's seed array out of its own state", () => {
    const seeds = [splat(0.1)];
    const schedule = new FrameSchedule(seeds);
    seeds.push(splat(0.9));

    const s = sink(() => []);
    schedule.advance(TIME_STEP, s);
    expect(s.frames).toEqual([[splat(0.1)]]);
  });

  it("drops the accrued budget on pause, so a reopened gate replays nothing", () => {
    const schedule = new FrameSchedule();
    const s = sink();

    schedule.advance(TIME_STEP * 0.9, s);
    schedule.pause();

    expect(schedule.advance(TIME_STEP * 0.9, s)).toBe(0);
  });

  it("still steps on a backwards frame's successor, banking nothing from it", () => {
    const schedule = new FrameSchedule();
    const s = sink();

    // Because Chromium was measured giving the first rAF callback a timestamp
    // before the performance.now() that seeded it; unfloored this banks a step.
    expect(schedule.advance(-4.3 / 1000, s)).toBe(0);
    expect(schedule.advance(TIME_STEP, s)).toBe(1);
  });
});
