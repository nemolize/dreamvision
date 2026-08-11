import {
  DYE_DISSIPATION,
  DYE_RESOLUTION,
  PRESSURE_ITERATIONS,
  SIM_RESOLUTION,
  SPLAT_RADIUS,
  TIME_STEP,
  VELOCITY_DISSIPATION,
  WORKGROUP_SIZE,
} from "./config";
import type { ProjectionScale } from "./projection";
import { projectionScale, projectionUniform } from "./projection";
import renderShaderSource from "./render.wgsl?raw";
import simulationShaderSource from "./simulation.wgsl?raw";
import type { FluidRenderer, Pointer } from "./types";

/** Float index of each `Uniforms` member in `simulation.wgsl` — WGSL aligns
 * the `vec4f` to 16 bytes, leaving a hole a positional array would misfill. */
const UNIFORM = {
  simSize: 0,
  splatPoint: 2,
  splatDelta: 4,
  splatColor: 8,
  dt: 12,
  splatRadius: 13,
  splatActive: 14,
  aspect: 15,
  toCells: 16,
  toStored: 18,
} as const;

const UNIFORM_FLOATS = 20;
const UNIFORM_BYTES = UNIFORM_FLOATS * 4;

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
  ): GPUComputePipeline =>
    device.createComputePipeline({
      label: entryPoint,
      layout: device.createPipelineLayout({
        bindGroupLayouts: [sharedLayout, passLayout],
      }),
      compute: { module: simulationModule, entryPoint },
    });

  const pipelines = {
    advect: computePipeline("advect", advectLayout),
    divergence: computePipeline("divergence", divergenceLayout),
    pressure: computePipeline("pressure", pressureLayout),
    gradientSubtract: computePipeline("gradientSubtract", gradientLayout),
    splat: computePipeline("splat", splatLayout),
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
    paramBuffers: readonly GPUBuffer[];
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

  let resources: Resources | null = null;

  const buildResources = (
    canvasWidth: number,
    canvasHeight: number,
  ): Resources => {
    const simGrid = fitGrid(canvasWidth, canvasHeight, SIM_RESOLUTION);
    const dyeGrid = fitGrid(canvasWidth, canvasHeight, DYE_RESOLUTION);
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

    const advectVelocityParams = makeParamBuffer([
      simGrid.width,
      simGrid.height,
      VELOCITY_DISSIPATION,
      0,
    ]);
    const advectDyeParams = makeParamBuffer([
      dyeGrid.width,
      dyeGrid.height,
      DYE_DISSIPATION,
      0,
    ]);
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
      paramBuffers: [
        advectVelocityParams,
        advectDyeParams,
        splatVelocityParams,
        splatDyeParams,
      ],
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
    for (const buffer of current.paramBuffers) buffer.destroy();
  };

  const resize = (canvasWidth: number, canvasHeight: number): void => {
    if (resources !== null) releaseResources(resources);
    resources = buildResources(canvasWidth, canvasHeight);
  };

  resize(width, height);

  const frame = (pointer: Pointer): void => {
    const current = resources;
    if (current === null) return;

    const { simGrid, dyeGrid, scale, velocity, dye, pressure } = current;

    uniformData.set([simGrid.width, simGrid.height], UNIFORM.simSize);
    uniformData.set([pointer.x, pointer.y], UNIFORM.splatPoint);
    uniformData.set([pointer.dx, pointer.dy], UNIFORM.splatDelta);
    uniformData.set(pointer.color, UNIFORM.splatColor);
    uniformData[UNIFORM.dt] = TIME_STEP;
    uniformData[UNIFORM.splatRadius] = SPLAT_RADIUS;
    uniformData[UNIFORM.splatActive] = pointer.down ? 1 : 0;
    uniformData[UNIFORM.aspect] = dyeGrid.width / dyeGrid.height;
    const metric = projectionUniform(scale);
    uniformData.set(metric.toCells, UNIFORM.toCells);
    uniformData.set(metric.toStored, UNIFORM.toStored);

    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

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

    run(pipelines.splat, current.splatVelocity[velocity.readFace], simDispatch);
    velocity.swap();

    run(pipelines.splat, current.splatDye[dye.readFace], dyeDispatch);
    dye.swap();

    // 3. Project: make the velocity field divergence-free.
    run(
      pipelines.divergence,
      current.divergencePass[velocity.readFace],
      simDispatch,
    );

    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
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
    resize,
    destroy: () => {
      if (resources !== null) releaseResources(resources);
      resources = null;
      uniformBuffer.destroy();
    },
  };
};
