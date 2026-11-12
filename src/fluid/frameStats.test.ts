import { describe, expect, it, vi } from "vitest";

import { STATS_WINDOW_MS } from "./config";
import type { FrameReading } from "./frameStats";
import { FrameStats, StatsMeter } from "./frameStats";
import type { FluidRenderer } from "./types";

describe("FrameStats", () => {
  it("shows nothing until the window has run its length", () => {
    const stats = new FrameStats();
    stats.reset(1000);
    stats.frame();

    expect(stats.poll(1000 + STATS_WINDOW_MS - 1)).toBeNull();
  });

  it("averages the frame rate and the GPU time over the window", () => {
    const stats = new FrameStats();
    stats.reset(1000);
    for (let frame = 0; frame < 30; frame++) stats.frame();
    stats.gpu(2);
    stats.gpu(4);
    stats.gpu(6);

    expect(stats.poll(1500)).toEqual({ fps: 60, gpuMilliseconds: 4 });
  });

  it("divides by the time the window actually took, not its nominal length", () => {
    const stats = new FrameStats();
    stats.reset(0);
    for (let frame = 0; frame < 5; frame++) stats.frame();

    expect(stats.poll(1000)?.fps).toBe(5);
  });

  it("opens the next window empty", () => {
    const stats = new FrameStats();
    stats.reset(0);
    stats.frame();
    stats.gpu(8);
    stats.poll(STATS_WINDOW_MS);

    stats.frame();
    stats.gpu(2);

    expect(stats.poll(2 * STATS_WINDOW_MS)).toEqual({
      fps: 2,
      gpuMilliseconds: 2,
    });
  });

  it("reads a window that drew no frame as empty, even if a timestamp arrived late", () => {
    const stats = new FrameStats();
    stats.reset(0);
    stats.gpu(3);

    expect(stats.poll(STATS_WINDOW_MS)).toEqual({
      fps: null,
      gpuMilliseconds: null,
    });
  });

  it("keeps the frame rate when no timestamp arrived", () => {
    const stats = new FrameStats();
    stats.reset(0);
    stats.frame();

    expect(stats.poll(STATS_WINDOW_MS)).toEqual({
      fps: 2,
      gpuMilliseconds: null,
    });
  });
});

const meterOf = () => {
  const renderer = { measureGpu: vi.fn<FluidRenderer["measureGpu"]>() };
  const readings: (FrameReading | null)[] = [];
  const meter = new StatsMeter(renderer, (reading) => {
    readings.push(reading);
  });
  const listener = (): ((milliseconds: number) => void) => {
    const given = renderer.measureGpu.mock.lastCall?.[0];
    if (given === null || given === undefined) throw new Error("no listener");
    return given;
  };
  return { renderer, readings, meter, listener };
};

describe("StatsMeter", () => {
  it("measures and publishes nothing while hidden", () => {
    const { renderer, readings, meter } = meterOf();

    meter.update(0, false, true);
    meter.update(STATS_WINDOW_MS, false, true);

    expect(renderer.measureGpu).not.toHaveBeenCalled();
    expect(readings).toEqual([]);
  });

  it("starts GPU timing when shown and publishes one reading per window", () => {
    const { renderer, readings, meter, listener } = meterOf();

    meter.update(0, true, false);
    expect(renderer.measureGpu).toHaveBeenCalledTimes(1);
    for (const now of [100, 200, 300, 400]) {
      listener()(2);
      meter.update(now, true, true);
    }
    meter.update(500, true, true);

    expect(readings).toEqual([{ fps: 10, gpuMilliseconds: 2 }]);
  });

  it("counts an animation frame that drew nothing toward the window's time, not its frames", () => {
    const { readings, meter } = meterOf();

    meter.update(0, true, false);
    meter.update(250, true, false);
    meter.update(500, true, false);

    expect(readings).toEqual([{ fps: null, gpuMilliseconds: null }]);
  });

  it("stops the timing and clears the reading when hidden, and starts clean when shown again", () => {
    const { renderer, readings, meter } = meterOf();
    meter.update(0, true, true);
    meter.update(500, true, true);

    meter.update(600, false, true);

    expect(renderer.measureGpu).toHaveBeenLastCalledWith(null);
    expect(readings.at(-1)).toBeNull();

    meter.update(700, true, true);
    meter.update(1200, true, true);

    expect(readings.at(-1)).toEqual({ fps: 2, gpuMilliseconds: null });
  });
});
