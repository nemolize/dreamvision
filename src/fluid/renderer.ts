import { MAX_SPLATS_PER_FRAME, TIME_STEP } from "./config";
import type { DoubleBuffer } from "./doubleBuffer";
import { encodeFrame } from "./frame";
import type { Grid } from "./grid";
import { fitGrids, needsRebuild } from "./grid";
import { createPipelines } from "./pipelines";
import type { ResampleField } from "./resample";
import { createFieldResampler } from "./resample";
import type { ResolutionSettings } from "./resolution";
import { sameResolution } from "./resolution";
import type { Resources } from "./resources";
import { buildResources, releaseResources } from "./resources";
import type { FluidSettings } from "./settings";
import { DEFAULT_SETTINGS } from "./settings";
import type { FluidRenderer, Splat } from "./types";
import {
  ADVECT_PARAM,
  packSplatUniforms,
  packUniforms,
  SPLAT_UNIFORM_BYTES,
  SPLAT_UNIFORM_FLOATS,
  UNIFORM_BYTES,
  UNIFORM_FLOATS,
} from "./uniforms";

export const createFluidRenderer = (
  device: GPUDevice,
  context: GPUCanvasContext,
  canvasFormat: GPUTextureFormat,
  width: number,
  height: number,
  initialResolution: ResolutionSettings,
): FluidRenderer => {
  const pipelines = createPipelines(device, canvasFormat);

  const uniformBuffer = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const uniformData = new Float32Array(UNIFORM_FLOATS);

  // Rounded UP rather than max()'d: a device whose alignment is below the
  // struct size would otherwise get offsets that are not multiples of it.
  const splatAlignment = device.limits.minUniformBufferOffsetAlignment;
  const splatSlotBytes =
    Math.ceil(SPLAT_UNIFORM_BYTES / splatAlignment) * splatAlignment;
  const splatBuffer = device.createBuffer({
    size: splatSlotBytes * MAX_SPLATS_PER_FRAME,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const splatData = new Float32Array(SPLAT_UNIFORM_FLOATS);

  const sharedBindGroup = device.createBindGroup({
    layout: pipelines.sharedLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const splatUniformBindGroup = device.createBindGroup({
    layout: pipelines.splatUniformLayout,
    entries: [
      {
        binding: 0,
        resource: { buffer: splatBuffer, size: SPLAT_UNIFORM_BYTES },
      },
    ],
  });

  const resampler = createFieldResampler(
    device,
    pipelines.simulationModule,
    pipelines.sharedLayout,
  );

  let resources: Resources | null = null;
  let settings: FluidSettings = DEFAULT_SETTINGS;
  let resolution: ResolutionSettings = initialResolution;
  let canvasSize = { width, height };

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
    const next = buildResources(
      device,
      pipelines,
      fitGrids(canvasWidth, canvasHeight, resolution),
      settings,
    );
    if (previous !== null) {
      carryFields(previous, next);
      releaseResources(previous);
    }
    resources = next;
  };

  /** Thins a drag's rebuild storm rather than stopping it: the finer dye grid
   * decides, and at a square aspect it steps every pixel, so this never fires. */
  const resize = (canvasWidth: number, canvasHeight: number): void => {
    canvasSize = { width: canvasWidth, height: canvasHeight };
    if (
      !needsRebuild(resources, fitGrids(canvasWidth, canvasHeight, resolution))
    ) {
      return;
    }
    rebuild(canvasWidth, canvasHeight);
  };

  const setResolution = (next: ResolutionSettings): void => {
    if (sameResolution(next, resolution)) return;
    resolution = next;
    rebuild(canvasSize.width, canvasSize.height);
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

    packUniforms(
      uniformData,
      current.simGrid,
      current.dyeGrid,
      current.scale,
      TIME_STEP,
    );
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const applied = splats.slice(0, MAX_SPLATS_PER_FRAME);
    applied.forEach((splat, index) => {
      packSplatUniforms(splatData, splat, settings.splatRadius);
      device.queue.writeBuffer(
        splatBuffer,
        index * splatSlotBytes,
        splatData.buffer,
        splatData.byteOffset,
        splatData.byteLength,
      );
    });

    encodeFrame({
      device,
      context,
      pipelines,
      resources: current,
      sharedBindGroup,
      splatUniformBindGroup,
      splatCount: applied.length,
      splatSlotBytes,
      pressureIterations: settings.pressureIterations,
    });
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
