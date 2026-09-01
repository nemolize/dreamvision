import { WORKGROUP_SIZE } from "./config";
import renderShaderSource from "./render.wgsl?raw";
import simulationShaderSource from "./simulation.wgsl?raw";
import { SPLAT_UNIFORM_BYTES } from "./uniforms";

// 32-bit float: WebGPU guarantees write-only storage access for these, while
// the 16-bit forms need an optional feature.
export const VELOCITY_FORMAT: GPUTextureFormat = "rgba32float";
export const DYE_FORMAT: GPUTextureFormat = "rgba32float";
export const PRESSURE_FORMAT: GPUTextureFormat = "r32float";

/** Layouts ride along because a bind group must be built against the same
 * layout object its pipeline was — an identical-shape copy is a different one. */
export interface Pipelines {
  simulationModule: GPUShaderModule;
  sharedLayout: GPUBindGroupLayout;
  splatUniformLayout: GPUBindGroupLayout;
  advectLayout: GPUBindGroupLayout;
  divergenceLayout: GPUBindGroupLayout;
  pressureLayout: GPUBindGroupLayout;
  gradientLayout: GPUBindGroupLayout;
  splatLayout: GPUBindGroupLayout;
  renderLayout: GPUBindGroupLayout;
  advect: GPUComputePipeline;
  divergence: GPUComputePipeline;
  pressure: GPUComputePipeline;
  gradientSubtract: GPUComputePipeline;
  splat: GPUComputePipeline;
  display: GPURenderPipeline;
}

export const createPipelines = (
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
): Pipelines => {
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

  const sharedLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
    ],
  });

  const splatUniformLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: SPLAT_UNIFORM_BYTES,
        },
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

  const renderLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "unfilterable-float" },
      },
    ],
  });

  const display = device.createRenderPipeline({
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

  return {
    simulationModule,
    sharedLayout,
    splatUniformLayout,
    advectLayout,
    divergenceLayout,
    pressureLayout,
    gradientLayout,
    splatLayout,
    renderLayout,
    advect: computePipeline("advect", advectLayout),
    divergence: computePipeline("divergence", divergenceLayout),
    pressure: computePipeline("pressure", pressureLayout),
    gradientSubtract: computePipeline("gradientSubtract", gradientLayout),
    splat: computePipeline("splat", splatLayout, splatUniformLayout),
    display,
  };
};
