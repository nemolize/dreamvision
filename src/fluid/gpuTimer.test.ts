import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGpuTimer } from "./gpuTimer";

const NS_PER_MS = 1e6;

interface FakeReadback {
  mapAsync: ReturnType<typeof vi.fn>;
  getMappedRange: ReturnType<typeof vi.fn>;
  unmap: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

const fakeDevice = (
  features: readonly string[],
  ticks: bigint[] = [0n, 0n],
) => {
  const resolveBuffer = { destroy: vi.fn() };
  const readback: FakeReadback = {
    mapAsync: vi.fn().mockResolvedValue(undefined),
    getMappedRange: vi.fn(() => new BigInt64Array(ticks).buffer),
    unmap: vi.fn(),
    destroy: vi.fn(),
  };
  const querySet = { destroy: vi.fn() };
  const buffers = [resolveBuffer, readback];
  const device = {
    features: new Set(features),
    createQuerySet: vi.fn(() => querySet),
    createBuffer: vi.fn(() => {
      const next = buffers.shift();
      if (next === undefined) throw new Error("unexpected third buffer");
      return next;
    }),
  };
  return { device, querySet, resolveBuffer, readback };
};

const isDevice = (_value: unknown): _value is GPUDevice => true;
const isEncoder = (_value: unknown): _value is GPUCommandEncoder => true;

const asDevice = (fake: ReturnType<typeof fakeDevice>): GPUDevice => {
  if (!isDevice(fake.device)) throw new Error("unreachable");
  return fake.device;
};

const timerOf = (fake: ReturnType<typeof fakeDevice>) => {
  const timer = createGpuTimer(asDevice(fake));
  if (timer === null) throw new Error("expected a timer");
  return timer;
};

beforeEach(() => {
  vi.stubGlobal("GPUBufferUsage", {
    QUERY_RESOLVE: 1,
    COPY_SRC: 2,
    COPY_DST: 4,
    MAP_READ: 8,
  });
  vi.stubGlobal("GPUMapMode", { READ: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGpuTimer", () => {
  it("is absent on a device without timestamp-query", () => {
    const fake = fakeDevice([]);

    expect(createGpuTimer(asDevice(fake))).toBeNull();
    expect(fake.device.createQuerySet).not.toHaveBeenCalled();
  });

  it("reads the elapsed time between the two timestamps, in milliseconds", async () => {
    const fake = fakeDevice(
      ["timestamp-query"],
      [5_000_000n, BigInt(5_000_000 + 2.5 * NS_PER_MS)],
    );
    const timer = timerOf(fake);

    timer.begin();

    await expect(timer.read()).resolves.toBeCloseTo(2.5, 6);
    expect(fake.readback.unmap).toHaveBeenCalledTimes(1);
  });

  it("brackets one frame with the first slot as its start and the second as its end", () => {
    const timing = timerOf(fakeDevice(["timestamp-query"])).begin();

    expect(timing?.computeWrites).toMatchObject({
      beginningOfPassWriteIndex: 0,
    });
    expect(timing?.renderWrites).toMatchObject({ endOfPassWriteIndex: 1 });
  });

  it("copies the resolved timestamps to the readable buffer", () => {
    const fake = fakeDevice(["timestamp-query"]);
    const timing = timerOf(fake).begin();
    const resolveQuerySet = vi.fn();
    const copyBufferToBuffer = vi.fn();
    const encoder = { resolveQuerySet, copyBufferToBuffer };

    if (!isEncoder(encoder)) throw new Error("unreachable");
    timing?.resolve(encoder);

    expect(resolveQuerySet).toHaveBeenCalledExactlyOnceWith(
      fake.querySet,
      0,
      2,
      fake.resolveBuffer,
      0,
    );
    expect(copyBufferToBuffer).toHaveBeenCalledExactlyOnceWith(
      fake.resolveBuffer,
      0,
      fake.readback,
      0,
      16,
    );
  });

  it("starts no second reading while one is in flight, and starts again once it lands", async () => {
    const timer = timerOf(fakeDevice(["timestamp-query"]));

    expect(timer.begin()).not.toBeNull();
    expect(timer.begin()).toBeNull();
    await timer.read();

    expect(timer.begin()).not.toBeNull();
  });

  it("frees the slot when the readback fails, so one lost sample does not stop the timer", async () => {
    const fake = fakeDevice(["timestamp-query"]);
    fake.readback.mapAsync.mockRejectedValueOnce(new Error("device lost"));
    const timer = timerOf(fake);

    timer.begin();
    await expect(timer.read()).rejects.toThrow("device lost");

    expect(timer.begin()).not.toBeNull();
  });

  it("rejects timestamps that run backwards, and still unmaps", async () => {
    const fake = fakeDevice(["timestamp-query"], [9n, 3n]);
    const timer = timerOf(fake);

    timer.begin();
    await expect(timer.read()).rejects.toThrow("out of order");

    expect(fake.readback.unmap).toHaveBeenCalledTimes(1);
    expect(timer.begin()).not.toBeNull();
  });

  it("reads a zero-length frame as 0, which a coarse clock produces", async () => {
    const timer = timerOf(fakeDevice(["timestamp-query"], [7n, 7n]));

    timer.begin();

    await expect(timer.read()).resolves.toBe(0);
  });

  it("releases the query set and both buffers", () => {
    const fake = fakeDevice(["timestamp-query"]);

    timerOf(fake).destroy();

    expect(fake.querySet.destroy).toHaveBeenCalledTimes(1);
    expect(fake.resolveBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(fake.readback.destroy).toHaveBeenCalledTimes(1);
  });
});
