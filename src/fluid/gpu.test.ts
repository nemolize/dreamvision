import { afterEach, describe, expect, it, vi } from "vitest";

import { GpuUnavailableError, initGpu } from "@/fluid/gpu";

interface FakeWebGpu {
  requestAdapter: ReturnType<typeof vi.fn>;
  requestDevice: ReturnType<typeof vi.fn>;
  getPreferredCanvasFormat: ReturnType<typeof vi.fn>;
  device: object;
}

const stubWebGpu = (
  adapter: object | null,
  features: readonly string[] = [],
): FakeWebGpu => {
  const device = { label: "fake-device" };
  const requestDevice = vi.fn().mockResolvedValue(device);
  const fake: FakeWebGpu = {
    requestAdapter: vi
      .fn()
      .mockResolvedValue(
        adapter === null
          ? null
          : { requestDevice, features: new Set(features) },
      ),
    requestDevice,
    getPreferredCanvasFormat: vi.fn().mockReturnValue("bgra8unorm"),
    device,
  };
  vi.stubGlobal("navigator", {
    gpu: {
      requestAdapter: fake.requestAdapter,
      getPreferredCanvasFormat: fake.getPreferredCanvasFormat,
    },
  });
  return fake;
};

const canvasWith = (context: object | null): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.getContext = vi.fn().mockReturnValue(context);
  return canvas;
};

describe("initGpu", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports a browser without WebGPU", async () => {
    vi.stubGlobal("navigator", {});

    await expect(initGpu(canvasWith({}))).rejects.toThrow(
      new GpuUnavailableError(
        "This browser does not support WebGPU, which this simulation runs on.",
      ),
    );
  });

  it("reports a device without a GPU adapter", async () => {
    stubWebGpu(null);

    await expect(initGpu(canvasWith({}))).rejects.toThrow(
      new GpuUnavailableError("No GPU adapter is available on this device."),
    );
  });

  it("reports a canvas that cannot give a WebGPU context", async () => {
    stubWebGpu({});

    await expect(initGpu(canvasWith(null))).rejects.toThrow(
      new GpuUnavailableError("Could not create a WebGPU canvas context."),
    );
  });

  it("gives the error its class name", async () => {
    vi.stubGlobal("navigator", {});

    await expect(initGpu(canvasWith({}))).rejects.toMatchObject({
      name: "GpuUnavailableError",
    });
  });

  it("configures the context with the device and the preferred format", async () => {
    const gpu = stubWebGpu({});
    const context = { configure: vi.fn() };

    const result = await initGpu(canvasWith(context));

    expect(gpu.requestAdapter).toHaveBeenCalledWith({
      powerPreference: "high-performance",
    });
    expect(context.configure).toHaveBeenCalledExactlyOnceWith({
      device: gpu.device,
      format: "bgra8unorm",
      alphaMode: "opaque",
    });
    expect(result.device).toBe(gpu.device);
    expect(result).toEqual({
      device: gpu.device,
      context,
      format: "bgra8unorm",
    });
  });

  it("asks for GPU timestamps only when the adapter offers them", async () => {
    const offered = stubWebGpu({}, ["timestamp-query"]);
    await initGpu(canvasWith({ configure: vi.fn() }));
    expect(offered.requestDevice).toHaveBeenCalledExactlyOnceWith({
      requiredFeatures: ["timestamp-query"],
    });

    const withheld = stubWebGpu({});
    await initGpu(canvasWith({ configure: vi.fn() }));
    expect(withheld.requestDevice).toHaveBeenCalledExactlyOnceWith({
      requiredFeatures: [],
    });
  });
});
