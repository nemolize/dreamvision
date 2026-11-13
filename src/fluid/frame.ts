import type { FrameTiming } from "./gpuTimer";
import { dispatchSize } from "./grid";
import type { Pipelines } from "./pipelines";
import type { Resources } from "./resources";

export interface FrameEncode {
  device: GPUDevice;
  context: GPUCanvasContext;
  pipelines: Pipelines;
  resources: Resources;
  sharedBindGroup: GPUBindGroup;
  splatUniformBindGroup: GPUBindGroup;
  splatCount: number;
  splatSlotBytes: number;
  pressureIterations: number;
  vorticityConfinement: number;
  gravity: number;
  timing: FrameTiming | null;
}

export const encodeFrame = ({
  device,
  context,
  pipelines,
  resources,
  sharedBindGroup,
  splatUniformBindGroup,
  splatCount,
  splatSlotBytes,
  pressureIterations,
  vorticityConfinement,
  gravity,
  timing,
}: FrameEncode): void => {
  const { simGrid, dyeGrid, velocity, dye, pressure } = resources;

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass(
    timing === null ? undefined : { timestampWrites: timing.computeWrites },
  );
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

  run(
    pipelines.advect,
    resources.advectVelocity[velocity.readFace],
    simDispatch,
  );
  velocity.swap();

  // Every splat is a full pass over both grids, so the frame's cost grows with
  // their count — the seed burst is deliberately a one-off.
  for (let index = 0; index < splatCount; index++) {
    pass.setBindGroup(2, splatUniformBindGroup, [index * splatSlotBytes]);

    run(
      pipelines.splat,
      resources.splatVelocity[velocity.readFace],
      simDispatch,
    );
    velocity.swap();

    run(pipelines.splat, resources.splatDye[dye.readFace], dyeDispatch);
    dye.swap();
  }

  if (vorticityConfinement > 0) {
    run(pipelines.curl, resources.curlPass[velocity.readFace], simDispatch);
    run(
      pipelines.confine,
      resources.confinePass[velocity.readFace],
      simDispatch,
    );
    velocity.swap();
  }

  if (gravity !== 0) {
    run(
      pipelines.buoyancy,
      resources.buoyancyPass[velocity.readFace][dye.readFace],
      simDispatch,
    );
    velocity.swap();
  }

  run(
    pipelines.divergence,
    resources.divergencePass[velocity.readFace],
    simDispatch,
  );

  for (let i = 0; i < pressureIterations; i++) {
    run(
      pipelines.pressure,
      resources.pressurePass[pressure.readFace],
      simDispatch,
    );
    pressure.swap();
  }

  run(
    pipelines.gradientSubtract,
    resources.gradientPass[pressure.readFace][velocity.readFace],
    simDispatch,
  );
  velocity.swap();

  run(
    pipelines.advect,
    resources.advectDye[velocity.readFace][dye.readFace],
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
    ...(timing !== null && { timestampWrites: timing.renderWrites }),
  });
  display.setPipeline(pipelines.display);
  display.setBindGroup(0, resources.display[dye.readFace]);
  display.draw(3);
  display.end();

  timing?.resolve(encoder);

  device.queue.submit([encoder.finish()]);
};
