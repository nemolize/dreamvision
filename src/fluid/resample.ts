import { WORKGROUP_SIZE } from "./config";

const PARAM_BYTES = 16;

export interface ResampleField {
  view: GPUTextureView;
  width: number;
  height: number;
}

export interface ResamplePair {
  source: ResampleField;
  target: ResampleField;
}

export interface FieldResampler {
  encodeInto: (
    pass: GPUComputePassEncoder,
    pairs: readonly ResamplePair[],
  ) => void;
  destroy: () => void;
}

/** Carries a field onto a differently-sized grid, so a rebuild can preserve
 * what the solver had rather than starting from an empty texture. */
export const createFieldResampler = (
  device: GPUDevice,
  module: GPUShaderModule,
  sharedLayout: GPUBindGroupLayout,
): FieldResampler => {
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: "write-only", format: "rgba32float" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
    ],
  });

  const pipeline = device.createComputePipeline({
    label: "resample",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [sharedLayout, layout],
    }),
    compute: { module, entryPoint: "resample" },
  });

  // One buffer per pair, not one reused: a rebuild encodes every dispatch
  // before its submit, so a shared buffer would hand them all the last sizes.
  const paramBuffers: GPUBuffer[] = [];
  const paramsFor = (index: number): GPUBuffer => {
    const existing = paramBuffers[index];
    if (existing !== undefined) return existing;
    const created = device.createBuffer({
      label: `resample-params-${String(index)}`,
      size: PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    paramBuffers[index] = created;
    return created;
  };

  const encodeInto = (
    pass: GPUComputePassEncoder,
    pairs: readonly ResamplePair[],
  ): void => {
    pass.setPipeline(pipeline);
    pairs.forEach(({ source, target }, index) => {
      const params = paramsFor(index);
      device.queue.writeBuffer(
        params,
        0,
        new Float32Array([
          source.width,
          source.height,
          target.width,
          target.height,
        ]),
      );
      pass.setBindGroup(
        1,
        device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: source.view },
            { binding: 1, resource: target.view },
            { binding: 2, resource: { buffer: params } },
          ],
        }),
      );
      pass.dispatchWorkgroups(
        Math.ceil(target.width / WORKGROUP_SIZE),
        Math.ceil(target.height / WORKGROUP_SIZE),
      );
    });
  };

  return {
    encodeInto,
    destroy: () => {
      for (const buffer of paramBuffers) buffer.destroy();
      paramBuffers.length = 0;
    },
  };
};
