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
}: FrameEncode): void => {
  const { simGrid, dyeGrid, velocity, dye, pressure } = resources;

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
  });
  display.setPipeline(pipelines.display);
  display.setBindGroup(0, resources.display[dye.readFace]);
  display.draw(3);
  display.end();

  device.queue.submit([encoder.finish()]);
};
