import { MAX_SPLATS_PER_FRAME, TIME_STEP, WORKGROUP_SIZE } from "./config";
import type { ProjectionScale } from "./projection";
import { projectionScale, projectionUniform } from "./projection";
import renderShaderSource from "./render.wgsl?raw";
import type { ResampleField } from "./resample";
import { createFieldResampler } from "./resample";
import type { ResolutionSettings } from "./resolution";
import { DEFAULT_RESOLUTION } from "./resolution";
import type { FluidSettings } from "./settings";
import { DEFAULT_SETTINGS } from "./settings";
import simulationShaderSource from "./simulation.wgsl?raw";
import type { FluidRenderer, Splat } from "./types";

/** Float index of each `Uniforms` member in `simulation.wgsl`. */
const UNIFORM = {
  simSize: 0,
  dt: 2,
  aspect: 3,
  toCells: 4,
  toStored: 6,
} as const;

const UNIFORM_FLOATS = 8;
const UNIFORM_BYTES = UNIFORM_FLOATS * 4;

/** Float index of each `SplatUniforms` member in `simulation.wgsl` — WGSL
 * aligns the `vec4f` to 16 bytes, leaving a hole a positional array would
 * misfill. */
const SPLAT_UNIFORM = {
  point: 0,
  delta: 2,
  color: 4,
  radius: 8,
} as const;

const SPLAT_UNIFORM_FLOATS = 12;

const ADVECT_PARAM = {
  gridSize: 0,
  dissipation: 2,
} as const;

const PARAM_BYTES = 16;

// 32-bit float: WebGPU guarantees write-only storage access for these, while
// the 16-bit forms need an optional feature.
const VELOCITY_FORMAT: GPUTextureFormat = "rgba32float";
const DYE_FORMAT: GPUTextureFormat = "rgba32float";
const PRESSURE_FORMAT: GPUTextureFormat = "r32float";

const STORAGE_USAGE =
  GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;

interface Grid {
  width: number;
  height: number;
}

/** A pair of same-format textures written alternately: a compute pass may not
 * read and write one texture, so each step reads `read` and writes `write`,
 * then the two are swapped. */
class DoubleBuffer {
  readonly views: readonly [GPUTextureView, GPUTextureView];
  private readonly textures: readonly [GPUTexture, GPUTexture];
  /** Which of the two faces currently holds the live field. */
  private face: 0 | 1 = 0;

  constructor(device: GPUDevice, grid: Grid, format: GPUTextureFormat) {
    const create = (): GPUTexture =>
      device.createTexture({
        size: [grid.width, grid.height],
        format,
        usage: STORAGE_USAGE,
      });
    const first = create();
    const second = create();
    this.textures = [first, second];
    this.views = [first.createView(), second.createView()];
  }

  get readFace(): 0 | 1 {
    return this.face;
  }

  swap(): void {
    this.face = this.face === 0 ? 1 : 0;
  }

  destroy(): void {
    for (const texture of this.textures) texture.destroy();
  }
}

/** Fit a grid of `resolution` cells on its longer axis to the canvas' aspect,
 * so cells stay square and the fluid is not stretched. */
const fitGrid = (width: number, height: number, resolution: number): Grid => {
  const aspect = width / height;
  const cells =
    aspect >= 1
      ? { width: resolution, height: resolution / aspect }
      : { width: resolution * aspect, height: resolution };
  return {
    width: Math.max(2, Math.round(cells.width)),
    height: Math.max(2, Math.round(cells.height)),
  };
};

const dispatchSize = (grid: Grid): [number, number] => [
  Math.ceil(grid.width / WORKGROUP_SIZE),
  Math.ceil(grid.height / WORKGROUP_SIZE),
];

export const createFluidRenderer = (
  device: GPUDevice,
  context: GPUCanvasContext,
  canvasFormat: GPUTextureFormat,
  width: number,
  height: number,
  initialResolution: ResolutionSettings = DEFAULT_RESOLUTION,
): FluidRenderer => {
  // Substituted rather than duplicated: the host's dispatch count and the
  // shader's workgroup size must agree, and a drift under-simulates in silence.
  const simulationModule = device.createShaderModule({
    code: simulationShaderSource.replaceAll(
      "WORKGROUP_SIZE",
      String(WORKGROUP_SIZE),
    ),
    label: "fluid-simulation",
  });
  const renderModule = device.createShaderModule({
    code: renderShaderSource,
    label: "fluid-render",
  });

  const uniformBuffer = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const uniformData = new Float32Array(UNIFORM_FLOATS);

  // Rounded UP rather than max()'d: a device whose alignment is below the
  // struct size would otherwise get offsets that are not multiples of it.
  const splatAlignment = device.limits.minUniformBufferOffsetAlignment;
  const splatSlotBytes =
    Math.ceil((SPLAT_UNIFORM_FLOATS * 4) / splatAlignment) * splatAlignment;
  const splatBuffer = device.createBuffer({
    size: splatSlotBytes * MAX_SPLATS_PER_FRAME,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const splatData = new Float32Array(SPLAT_UNIFORM_FLOATS);

  const sharedLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
    ],
  });

  const sharedBindGroup = device.createBindGroup({
    layout: sharedLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const splatUniformLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: SPLAT_UNIFORM_FLOATS * 4,
        },
      },
    ],
  });

  const splatUniformBindGroup = device.createBindGroup({
    layout: splatUniformLayout,
    entries: [
      {
        binding: 0,
        resource: { buffer: splatBuffer, size: SPLAT_UNIFORM_FLOATS * 4 },
      },
    ],
  });

  const texture = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    texture: { sampleType: "unfilterable-float" },
  });
  const storage = (
    binding: number,
    format: GPUTextureFormat,
  ): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    storageTexture: { access: "write-only", format },
  });
  const uniform = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type: "uniform" },
  });

  const advectLayout = device.createBindGroupLayout({
    entries: [texture(0), texture(1), storage(2, VELOCITY_FORMAT), uniform(3)],
  });
  const divergenceLayout = device.createBindGroupLayout({
    entries: [texture(0), storage(1, PRESSURE_FORMAT)],
  });
  const pressureLayout = device.createBindGroupLayout({
    entries: [texture(0), texture(1), storage(2, PRESSURE_FORMAT)],
  });
  const gradientLayout = device.createBindGroupLayout({
    entries: [texture(0), texture(1), storage(2, VELOCITY_FORMAT)],
  });
  const splatLayout = device.createBindGroupLayout({
    entries: [texture(0), storage(1, VELOCITY_FORMAT), uniform(2)],
  });

  const computePipeline = (
    entryPoint: string,
    passLayout: GPUBindGroupLayout,
    splatUniforms?: GPUBindGroupLayout,
  ): GPUComputePipeline =>
    device.createComputePipeline({
      label: entryPoint,
      layout: device.createPipelineLayout({
        bindGroupLayouts:
          splatUniforms === undefined
            ? [sharedLayout, passLayout]
            : [sharedLayout, passLayout, splatUniforms],
      }),
      compute: { module: simulationModule, entryPoint },
    });

  const pipelines = {
    advect: computePipeline("advect", advectLayout),
    divergence: computePipeline("divergence", divergenceLayout),
    pressure: computePipeline("pressure", pressureLayout),
    gradientSubtract: computePipeline("gradientSubtract", gradientLayout),
    splat: computePipeline("splat", splatLayout, splatUniformLayout),
  };

  const renderLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "unfilterable-float" },
      },
    ],
  });

  const renderPipeline = device.createRenderPipeline({
    label: "fluid-display",
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
    vertex: { module: renderModule, entryPoint: "vertexMain" },
    fragment: {
      module: renderModule,
      entryPoint: "fragmentMain",
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: "triangle-list" },
  });

  const makeParamBuffer = (values: readonly number[]): GPUBuffer => {
    const buffer = device.createBuffer({
      size: PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const data = new Float32Array(PARAM_BYTES / 4);
    data.set(values);
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };

  const makeAdvectParams = (grid: Grid, dissipation: number): GPUBuffer => {
    const values = new Array<number>(PARAM_BYTES / 4).fill(0);
    values[ADVECT_PARAM.gridSize] = grid.width;
    values[ADVECT_PARAM.gridSize + 1] = grid.height;
    values[ADVECT_PARAM.dissipation] = dissipation;
    return makeParamBuffer(values);
  };

  /** One bind group per face the source buffer may be on, indexed by that
   * face — the pressure solve alone would otherwise build one per sweep. */
  type FacePair = readonly [GPUBindGroup, GPUBindGroup];

  interface Resources {
    simGrid: Grid;
    dyeGrid: Grid;
    /** Fixed by the grid and the canvas, so resolved once per resize. */
    scale: ProjectionScale;
    velocity: DoubleBuffer;
    dye: DoubleBuffer;
    pressure: DoubleBuffer;
    divergence: GPUTexture;
    ownedParamBuffers: readonly GPUBuffer[];
    advectVelocityParams: GPUBuffer;
    advectDyeParams: GPUBuffer;
    advectVelocity: FacePair;
    /** Indexed by velocity face, then dye face: dye advection reads both. */
    advectDye: readonly [FacePair, FacePair];
    splatVelocity: FacePair;
    splatDye: FacePair;
    divergencePass: FacePair;
    pressurePass: FacePair;
    /** Indexed by pressure face, then velocity face. */
    gradientPass: readonly [FacePair, FacePair];
    display: FacePair;
  }

  const resampler = createFieldResampler(
    device,
    simulationModule,
    sharedLayout,
  );

  let resources: Resources | null = null;
  let settings: FluidSettings = DEFAULT_SETTINGS;
  let resolution: ResolutionSettings = initialResolution;
  let canvas = { width, height };

  const buildResources = (
    canvasWidth: number,
    canvasHeight: number,
  ): Resources => {
    const simGrid = fitGrid(
      canvasWidth,
      canvasHeight,
      resolution.simResolution,
    );
    const dyeGrid = fitGrid(
      canvasWidth,
      canvasHeight,
      resolution.dyeResolution,
    );
    const scale = projectionScale(simGrid.width, simGrid.height);

    const velocity = new DoubleBuffer(device, simGrid, VELOCITY_FORMAT);
    const dye = new DoubleBuffer(device, dyeGrid, DYE_FORMAT);
    const pressure = new DoubleBuffer(device, simGrid, PRESSURE_FORMAT);

    const divergence = device.createTexture({
      size: [simGrid.width, simGrid.height],
      format: PRESSURE_FORMAT,
      usage: STORAGE_USAGE,
    });
    const divergenceView = divergence.createView();

    const advectVelocityParams = makeAdvectParams(
      simGrid,
      settings.velocityDissipation,
    );
    const advectDyeParams = makeAdvectParams(dyeGrid, settings.dyeDissipation);
    const splatVelocityParams = makeParamBuffer([
      simGrid.width,
      simGrid.height,
      1,
      0,
    ]);
    const splatDyeParams = makeParamBuffer([
      dyeGrid.width,
      dyeGrid.height,
      0,
      0,
    ]);

    const bindGroup = (
      layout: GPUBindGroupLayout,
      entries: GPUBindGroupEntry[],
    ): GPUBindGroup => device.createBindGroup({ layout, entries });

    /** Build one bind group per face of `source`, given how to bind that face. */
    const perFace = (
      source: DoubleBuffer,
      build: (read: GPUTextureView, write: GPUTextureView) => GPUBindGroup,
    ): FacePair => [
      build(source.views[0], source.views[1]),
      build(source.views[1], source.views[0]),
    ];

    const advectVelocity = perFace(velocity, (read, write) =>
      bindGroup(advectLayout, [
        { binding: 0, resource: read },
        { binding: 1, resource: read },
        { binding: 2, resource: write },
        { binding: 3, resource: { buffer: advectVelocityParams } },
      ]),
    );

    const advectDye: readonly [FacePair, FacePair] = [
      perFace(dye, (read, write) =>
        bindGroup(advectLayout, [
          { binding: 0, resource: read },
          { binding: 1, resource: velocity.views[0] },
          { binding: 2, resource: write },
          { binding: 3, resource: { buffer: advectDyeParams } },
        ]),
      ),
      perFace(dye, (read, write) =>
        bindGroup(advectLayout, [
          { binding: 0, resource: read },
          { binding: 1, resource: velocity.views[1] },
          { binding: 2, resource: write },
          { binding: 3, resource: { buffer: advectDyeParams } },
        ]),
      ),
    ];

    const splatVelocity = perFace(velocity, (read, write) =>
      bindGroup(splatLayout, [
        { binding: 0, resource: read },
        { binding: 1, resource: write },
        { binding: 2, resource: { buffer: splatVelocityParams } },
      ]),
    );

    const splatDye = perFace(dye, (read, write) =>
      bindGroup(splatLayout, [
        { binding: 0, resource: read },
        { binding: 1, resource: write },
        { binding: 2, resource: { buffer: splatDyeParams } },
      ]),
    );

    const divergencePass = perFace(velocity, (read) =>
      bindGroup(divergenceLayout, [
        { binding: 0, resource: read },
        { binding: 1, resource: divergenceView },
      ]),
    );

    const pressurePass = perFace(pressure, (read, write) =>
      bindGroup(pressureLayout, [
        { binding: 0, resource: read },
        { binding: 1, resource: divergenceView },
        { binding: 2, resource: write },
      ]),
    );

    const gradientPass: readonly [FacePair, FacePair] = [
      perFace(velocity, (read, write) =>
        bindGroup(gradientLayout, [
          { binding: 0, resource: pressure.views[0] },
          { binding: 1, resource: read },
          { binding: 2, resource: write },
        ]),
      ),
      perFace(velocity, (read, write) =>
        bindGroup(gradientLayout, [
          { binding: 0, resource: pressure.views[1] },
          { binding: 1, resource: read },
          { binding: 2, resource: write },
        ]),
      ),
    ];

    const display = perFace(dye, (read) =>
      bindGroup(renderLayout, [{ binding: 0, resource: read }]),
    );

    return {
      simGrid,
      dyeGrid,
      scale,
      velocity,
      dye,
      pressure,
      divergence,
      ownedParamBuffers: [
        advectVelocityParams,
        advectDyeParams,
        splatVelocityParams,
        splatDyeParams,
      ],
      advectVelocityParams,
      advectDyeParams,
      advectVelocity,
      advectDye,
      splatVelocity,
      splatDye,
      divergencePass,
      pressurePass,
      gradientPass,
      display,
    };
  };

  const releaseResources = (current: Resources): void => {
    current.velocity.destroy();
    current.dye.destroy();
    current.pressure.destroy();
    current.divergence.destroy();
    for (const buffer of current.ownedParamBuffers) buffer.destroy();
  };

  const liveFace = (buffer: DoubleBuffer, grid: Grid): ResampleField => ({
    view: buffer.views[buffer.readFace],
    width: grid.width,
    height: grid.height,
  });

  /** Pressure is left behind rather than carried: the Jacobi sweeps rebuild it
   * from the divergence within the frame, so resampling it buys nothing. */
  const carryFields = (previous: Resources, next: Resources): void => {
    const encoder = device.createCommandEncoder({ label: "fluid-rebuild" });
    const pass = encoder.beginComputePass();
    pass.setBindGroup(0, sharedBindGroup);
    resampler.encodeInto(pass, [
      {
        source: liveFace(previous.velocity, previous.simGrid),
        target: liveFace(next.velocity, next.simGrid),
      },
      {
        source: liveFace(previous.dye, previous.dyeGrid),
        target: liveFace(next.dye, next.dyeGrid),
      },
    ]);
    pass.end();
    device.queue.submit([encoder.finish()]);
  };

  /** Builds before releasing so the old fields can be resampled onto the new
   * grids; the two sets overlap for one submit, doubling texture memory. */
  const rebuild = (canvasWidth: number, canvasHeight: number): void => {
    const previous = resources;
    const next = buildResources(canvasWidth, canvasHeight);
    if (previous !== null) {
      carryFields(previous, next);
      releaseResources(previous);
    }
    resources = next;
  };

  const resize = (canvasWidth: number, canvasHeight: number): void => {
    canvas = { width: canvasWidth, height: canvasHeight };
    rebuild(canvasWidth, canvasHeight);
  };

  const setResolution = (next: ResolutionSettings): void => {
    if (
      next.simResolution === resolution.simResolution &&
      next.dyeResolution === resolution.dyeResolution
    ) {
      return;
    }
    resolution = next;
    rebuild(canvas.width, canvas.height);
  };

  const writeDissipation = (buffer: GPUBuffer, rate: number): void => {
    device.queue.writeBuffer(
      buffer,
      ADVECT_PARAM.dissipation * 4,
      new Float32Array([rate]),
    );
  };

  const applySettings = (next: FluidSettings): void => {
    settings = next;
    if (resources === null) return;
    writeDissipation(resources.advectVelocityParams, next.velocityDissipation);
    writeDissipation(resources.advectDyeParams, next.dyeDissipation);
  };

  resize(width, height);

  const frame = (splats: readonly Splat[]): void => {
    const current = resources;
    if (current === null) return;

    const { simGrid, dyeGrid, scale, velocity, dye, pressure } = current;

    uniformData.set([simGrid.width, simGrid.height], UNIFORM.simSize);
    uniformData[UNIFORM.dt] = TIME_STEP;
    uniformData[UNIFORM.aspect] = dyeGrid.width / dyeGrid.height;
    const metric = projectionUniform(scale);
    uniformData.set(metric.toCells, UNIFORM.toCells);
    uniformData.set(metric.toStored, UNIFORM.toStored);

    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const applied = splats.slice(0, MAX_SPLATS_PER_FRAME);
    applied.forEach((splat, index) => {
      splatData.set([splat.x, splat.y], SPLAT_UNIFORM.point);
      splatData.set([splat.dx, splat.dy], SPLAT_UNIFORM.delta);
      splatData.set(splat.color, SPLAT_UNIFORM.color);
      splatData[SPLAT_UNIFORM.radius] = settings.splatRadius;
      device.queue.writeBuffer(
        splatBuffer,
        index * splatSlotBytes,
        splatData.buffer,
        splatData.byteOffset,
        splatData.byteLength,
      );
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setBindGroup(0, sharedBindGroup);

    const simDispatch = dispatchSize(simGrid);
    const dyeDispatch = dispatchSize(dyeGrid);

    const run = (
      pipeline: GPUComputePipeline,
      group: GPUBindGroup,
      [x, y]: readonly [number, number],
    ): void => {
      pass.setPipeline(pipeline);
      pass.setBindGroup(1, group);
      pass.dispatchWorkgroups(x, y);
    };

    // 1. Advect velocity through itself.
    run(
      pipelines.advect,
      current.advectVelocity[velocity.readFace],
      simDispatch,
    );
    velocity.swap();

    // 2. Inject each splat's force and colour. Every splat is a full pass over
    // both grids, so the frame's cost grows with their count — the seed burst
    // is deliberately a one-off.
    applied.forEach((_, index) => {
      pass.setBindGroup(2, splatUniformBindGroup, [index * splatSlotBytes]);

      run(
        pipelines.splat,
        current.splatVelocity[velocity.readFace],
        simDispatch,
      );
      velocity.swap();

      run(pipelines.splat, current.splatDye[dye.readFace], dyeDispatch);
      dye.swap();
    });

    // 3. Project: make the velocity field divergence-free.
    run(
      pipelines.divergence,
      current.divergencePass[velocity.readFace],
      simDispatch,
    );

    for (let i = 0; i < settings.pressureIterations; i++) {
      run(
        pipelines.pressure,
        current.pressurePass[pressure.readFace],
        simDispatch,
      );
      pressure.swap();
    }

    run(
      pipelines.gradientSubtract,
      current.gradientPass[pressure.readFace][velocity.readFace],
      simDispatch,
    );
    velocity.swap();

    run(
      pipelines.advect,
      current.advectDye[velocity.readFace][dye.readFace],
      dyeDispatch,
    );
    dye.swap();

    pass.end();

    const display = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    display.setPipeline(renderPipeline);
    display.setBindGroup(0, current.display[dye.readFace]);
    display.draw(3);
    display.end();

    device.queue.submit([encoder.finish()]);
  };

  return {
    frame,
    applySettings,
    setResolution,
    resize,
    destroy: () => {
      if (resources !== null) releaseResources(resources);
      resources = null;
      resampler.destroy();
      uniformBuffer.destroy();
      splatBuffer.destroy();
    },
  };
};
