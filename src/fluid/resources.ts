import { DoubleBuffer } from "./doubleBuffer";
import type { Grid, GridPair } from "./grid";
import type { Pipelines } from "./pipelines";
import { DYE_FORMAT, PRESSURE_FORMAT, VELOCITY_FORMAT } from "./pipelines";
import type { ProjectionScale } from "./projection";
import { projectionScale } from "./projection";
import type { FluidSettings } from "./settings";
import { packAdvectParams, PARAM_BYTES, PARAM_FLOATS } from "./uniforms";

const STORAGE_USAGE =
  GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;

/** One bind group per face the source buffer may be on, indexed by that
 * face — the pressure solve alone would otherwise build one per sweep. */
export type FacePair = readonly [GPUBindGroup, GPUBindGroup];

/** A pass reading two double buffers: the name says which face indexes first,
 * since both orders type-check and swapping them binds the wrong texture. */
type ByVelocityThenDyeFace = readonly [FacePair, FacePair];
type ByPressureThenVelocityFace = readonly [FacePair, FacePair];

export interface Resources {
  simGrid: Grid;
  dyeGrid: Grid;
  scale: ProjectionScale;
  velocity: DoubleBuffer;
  dye: DoubleBuffer;
  pressure: DoubleBuffer;
  divergence: GPUTexture;
  ownedParamBuffers: readonly GPUBuffer[];
  advectVelocityParams: GPUBuffer;
  advectDyeParams: GPUBuffer;
  advectVelocity: FacePair;
  advectDye: ByVelocityThenDyeFace;
  splatVelocity: FacePair;
  splatDye: FacePair;
  divergencePass: FacePair;
  pressurePass: FacePair;
  gradientPass: ByPressureThenVelocityFace;
  display: FacePair;
}

export const buildResources = (
  device: GPUDevice,
  pipelines: Pipelines,
  { simGrid, dyeGrid }: GridPair,
  settings: FluidSettings,
): Resources => {
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

  const makeParamBuffer = (values: Float32Array): GPUBuffer => {
    const buffer = device.createBuffer({
      size: PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, values);
    return buffer;
  };

  const makeSplatParams = (grid: Grid, writesVelocity: number): GPUBuffer => {
    const values = new Float32Array(PARAM_FLOATS);
    values.set([grid.width, grid.height, writesVelocity]);
    return makeParamBuffer(values);
  };

  const advectVelocityParams = makeParamBuffer(
    packAdvectParams(simGrid, settings.velocityDissipation),
  );
  const advectDyeParams = makeParamBuffer(
    packAdvectParams(dyeGrid, settings.dyeDissipation),
  );
  const splatVelocityParams = makeSplatParams(simGrid, 1);
  const splatDyeParams = makeSplatParams(dyeGrid, 0);

  const bindGroup = (
    layout: GPUBindGroupLayout,
    entries: GPUBindGroupEntry[],
  ): GPUBindGroup => device.createBindGroup({ layout, entries });

  const perFace = (
    source: DoubleBuffer,
    build: (read: GPUTextureView, write: GPUTextureView) => GPUBindGroup,
  ): FacePair => [
    build(source.views[0], source.views[1]),
    build(source.views[1], source.views[0]),
  ];

  const advectVelocity = perFace(velocity, (read, write) =>
    bindGroup(pipelines.advectLayout, [
      { binding: 0, resource: read },
      { binding: 1, resource: read },
      { binding: 2, resource: write },
      { binding: 3, resource: { buffer: advectVelocityParams } },
    ]),
  );

  const advectDye: ByVelocityThenDyeFace = [
    perFace(dye, (read, write) =>
      bindGroup(pipelines.advectLayout, [
        { binding: 0, resource: read },
        { binding: 1, resource: velocity.views[0] },
        { binding: 2, resource: write },
        { binding: 3, resource: { buffer: advectDyeParams } },
      ]),
    ),
    perFace(dye, (read, write) =>
      bindGroup(pipelines.advectLayout, [
        { binding: 0, resource: read },
        { binding: 1, resource: velocity.views[1] },
        { binding: 2, resource: write },
        { binding: 3, resource: { buffer: advectDyeParams } },
      ]),
    ),
  ];

  const splatVelocity = perFace(velocity, (read, write) =>
    bindGroup(pipelines.splatLayout, [
      { binding: 0, resource: read },
      { binding: 1, resource: write },
      { binding: 2, resource: { buffer: splatVelocityParams } },
    ]),
  );

  const splatDye = perFace(dye, (read, write) =>
    bindGroup(pipelines.splatLayout, [
      { binding: 0, resource: read },
      { binding: 1, resource: write },
      { binding: 2, resource: { buffer: splatDyeParams } },
    ]),
  );

  const divergencePass = perFace(velocity, (read) =>
    bindGroup(pipelines.divergenceLayout, [
      { binding: 0, resource: read },
      { binding: 1, resource: divergenceView },
    ]),
  );

  const pressurePass = perFace(pressure, (read, write) =>
    bindGroup(pipelines.pressureLayout, [
      { binding: 0, resource: read },
      { binding: 1, resource: divergenceView },
      { binding: 2, resource: write },
    ]),
  );

  const gradientPass: ByPressureThenVelocityFace = [
    perFace(velocity, (read, write) =>
      bindGroup(pipelines.gradientLayout, [
        { binding: 0, resource: pressure.views[0] },
        { binding: 1, resource: read },
        { binding: 2, resource: write },
      ]),
    ),
    perFace(velocity, (read, write) =>
      bindGroup(pipelines.gradientLayout, [
        { binding: 0, resource: pressure.views[1] },
        { binding: 1, resource: read },
        { binding: 2, resource: write },
      ]),
    ),
  ];

  const display = perFace(dye, (read) =>
    bindGroup(pipelines.renderLayout, [{ binding: 0, resource: read }]),
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

export const releaseResources = (current: Resources): void => {
  current.velocity.destroy();
  current.dye.destroy();
  current.pressure.destroy();
  current.divergence.destroy();
  for (const buffer of current.ownedParamBuffers) buffer.destroy();
};
