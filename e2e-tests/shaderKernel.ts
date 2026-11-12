export interface KernelBuffer {
  group: number;
  binding: number;
  floats: number[];
}

export interface KernelRun {
  source: string;
  entryPoint: string;
  workgroupSize: number;
  width: number;
  height: number;
  textures: { binding: number; texels: number[] }[];
  output: { binding: number; channels: 1 | 4 };
  buffers: KernelBuffer[];
}

/** Runs inside the page via `page.evaluate`, so it can reference nothing
 * outside its own body. */
export const runKernel = async (run: KernelRun): Promise<number[]> => {
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) throw new Error("No WebGPU adapter");
  const device = await adapter.requestDevice();

  const { width, height } = run;
  const module = device.createShaderModule({ code: run.source });

  const uniformEntry = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type: "uniform" },
  });
  const buffersIn = (group: number) =>
    run.buffers.filter((buffer) => buffer.group === group);

  const sharedLayout = device.createBindGroupLayout({
    entries: buffersIn(0).map((buffer) => uniformEntry(buffer.binding)),
  });
  const passLayout = device.createBindGroupLayout({
    entries: [
      ...run.textures.map(({ binding }): GPUBindGroupLayoutEntry => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float" },
      })),
      {
        binding: run.output.binding,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: "write-only",
          format: run.output.channels === 1 ? "r32float" : "rgba32float",
        },
      },
      ...buffersIn(1).map((buffer) => uniformEntry(buffer.binding)),
    ],
  });
  const splatLayout = device.createBindGroupLayout({
    entries: buffersIn(2).map((buffer) => uniformEntry(buffer.binding)),
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [sharedLayout, passLayout, splatLayout],
    }),
    compute: { module, entryPoint: run.entryPoint },
  });

  const uniformBuffer = (floats: number[]): GPUBuffer => {
    const buffer = device.createBuffer({
      size: Math.ceil((floats.length * 4) / 16) * 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, new Float32Array(floats));
    return buffer;
  };
  const bufferEntry = (buffer: KernelBuffer): GPUBindGroupEntry => ({
    binding: buffer.binding,
    resource: { buffer: uniformBuffer(buffer.floats) },
  });

  const inputs = run.textures.map(({ binding, texels }) => {
    const texture = device.createTexture({
      size: [width, height],
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture },
      new Float32Array(texels),
      { bytesPerRow: width * 16 },
      [width, height],
    );
    return { binding, resource: texture.createView() };
  });
  const output = device.createTexture({
    size: [width, height],
    format: run.output.channels === 1 ? "r32float" : "rgba32float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  });

  const bytesPerTexel = run.output.channels * 4;
  const bytesPerRow = Math.ceil((width * bytesPerTexel) / 256) * 256;
  const readback = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: sharedLayout,
      entries: buffersIn(0).map(bufferEntry),
    }),
  );
  pass.setBindGroup(
    1,
    device.createBindGroup({
      layout: passLayout,
      entries: [
        ...inputs,
        { binding: run.output.binding, resource: output.createView() },
        ...buffersIn(1).map(bufferEntry),
      ],
    }),
  );
  if (buffersIn(2).length > 0) {
    pass.setBindGroup(
      2,
      device.createBindGroup({
        layout: splatLayout,
        entries: buffersIn(2).map(bufferEntry),
      }),
    );
  }
  pass.dispatchWorkgroups(
    Math.ceil(width / run.workgroupSize),
    Math.ceil(height / run.workgroupSize),
  );
  pass.end();
  encoder.copyTextureToBuffer(
    { texture: output },
    { buffer: readback, bytesPerRow },
    [width, height],
  );
  device.queue.submit([encoder.finish()]);

  await readback.mapAsync(GPUMapMode.READ);
  const raw = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  device.destroy();

  const floatsPerRow = bytesPerRow / 4;
  const texels: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < width * run.output.channels; i++) {
      texels.push(raw[y * floatsPerRow + i] ?? Number.NaN);
    }
  }
  return texels;
};
