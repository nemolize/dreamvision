export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

/** Thrown when the browser or the machine cannot run the simulation. The
 * message is shown to the user verbatim, so it stays plain. */
export class GpuUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GpuUnavailableError";
  }
}

export const initGpu = async (
  canvas: HTMLCanvasElement,
): Promise<GpuContext> => {
  // `@webgpu/types` declares `navigator.gpu` as always present, so the absent
  // case has to be tested through a check the types cannot narrow away.
  if (!("gpu" in navigator)) {
    throw new GpuUnavailableError(
      "This browser does not support WebGPU, which this simulation runs on.",
    );
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (adapter === null) {
    throw new GpuUnavailableError(
      "No GPU adapter is available on this device.",
    );
  }

  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  if (context === null) {
    throw new GpuUnavailableError("Could not create a WebGPU canvas context.");
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  return { device, context, format };
};
