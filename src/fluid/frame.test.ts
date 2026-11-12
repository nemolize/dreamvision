import { describe, expect, it } from "vitest";

import type { FrameEncode } from "./frame";
import { encodeFrame } from "./frame";
import type { FrameTiming } from "./gpuTimer";

type Call = readonly [pipeline: string, group: string];

const fakeBuffer = () => {
  let face: 0 | 1 = 0;
  return {
    get readFace(): 0 | 1 {
      return face;
    },
    swap: () => {
      face = face === 0 ? 1 : 0;
    },
  };
};

const isFrameEncode = (_value: unknown): _value is FrameEncode => true;
const isQuerySet = (_value: unknown): _value is GPUQuerySet => true;

const faces = (name: string): readonly [string, string] => [
  `${name}:0`,
  `${name}:1`,
];

interface Trace {
  computeDescriptors: unknown[];
  renderDescriptors: Record<string, unknown>[];
  order: string[];
}

const encode = (
  vorticityConfinement: number,
  buoyancy = 0,
  timing: FrameTiming | null = null,
  trace: Trace = { computeDescriptors: [], renderDescriptors: [], order: [] },
): Call[] => {
  const calls: Call[] = [];
  let group = "";
  let pipeline = "";
  const pass = {
    setBindGroup: (slot: number, bound: string) => {
      if (slot === 1) group = bound;
    },
    setPipeline: (next: string) => {
      pipeline = next;
    },
    dispatchWorkgroups: () => {
      calls.push([pipeline, group]);
    },
    end: () => undefined,
  };
  const display = {
    setPipeline: () => undefined,
    setBindGroup: () => undefined,
    draw: () => undefined,
    end: () => undefined,
  };
  const device = {
    createCommandEncoder: () => ({
      beginComputePass: (descriptor: unknown) => {
        trace.computeDescriptors.push(descriptor);
        return pass;
      },
      beginRenderPass: (descriptor: Record<string, unknown>) => {
        trace.renderDescriptors.push(descriptor);
        return display;
      },
      finish: () => {
        trace.order.push("finish");
        return "commands";
      },
    }),
    queue: {
      submit: () => {
        trace.order.push("submit");
      },
    },
  };
  const context = {
    getCurrentTexture: () => ({ createView: () => "view" }),
  };

  const grid = { width: 8, height: 8 };
  const pipelines = Object.fromEntries(
    [
      "advect",
      "curl",
      "confine",
      "buoyancy",
      "divergence",
      "pressure",
      "gradientSubtract",
      "splat",
      "display",
    ].map((name) => [name, name]),
  );
  const resources = {
    simGrid: grid,
    dyeGrid: grid,
    velocity: fakeBuffer(),
    dye: fakeBuffer(),
    pressure: fakeBuffer(),
    advectVelocity: faces("advectVelocity"),
    advectDye: [faces("advectDye:0"), faces("advectDye:1")],
    splatVelocity: faces("splatVelocity"),
    splatDye: faces("splatDye"),
    curlPass: faces("curlPass"),
    confinePass: faces("confinePass"),
    buoyancyPass: [faces("buoyancyPass:0"), faces("buoyancyPass:1")],
    divergencePass: faces("divergencePass"),
    pressurePass: faces("pressurePass"),
    gradientPass: [faces("gradientPass:0"), faces("gradientPass:1")],
    display: faces("display"),
  };

  const frame = {
    device,
    context,
    pipelines,
    resources,
    sharedBindGroup: "shared",
    splatUniformBindGroup: "splatUniform",
    splatCount: 0,
    splatSlotBytes: 256,
    pressureIterations: 1,
    vorticityConfinement,
    buoyancy,
    timing,
  };
  if (!isFrameEncode(frame)) throw new Error("unreachable");
  encodeFrame(frame);
  return calls;
};

describe("encodeFrame's vorticity confinement", () => {
  it("measures the curl and confines before the projection, reading each pass's own face", () => {
    const calls = encode(10);
    const names = calls.map(([pipeline]) => pipeline);

    expect(names).toStrictEqual([
      "advect",
      "curl",
      "confine",
      "divergence",
      "pressure",
      "gradientSubtract",
      "advect",
    ]);
    expect(calls[1]).toStrictEqual(["curl", "curlPass:1"]);
    expect(calls[2]).toStrictEqual(["confine", "confinePass:1"]);
    expect(calls[3]).toStrictEqual(["divergence", "divergencePass:0"]);
  });

  it("runs neither pass at strength 0, leaving the velocity face alone", () => {
    const calls = encode(0);

    expect(calls.map(([pipeline]) => pipeline)).toStrictEqual([
      "advect",
      "divergence",
      "pressure",
      "gradientSubtract",
      "advect",
    ]);
    expect(calls[1]).toStrictEqual(["divergence", "divergencePass:1"]);
  });
});

describe("encodeFrame's buoyancy", () => {
  it("lifts after the confinement and before the projection, reading velocity face then dye face", () => {
    const calls = encode(10, 10);

    expect(calls.map(([pipeline]) => pipeline)).toStrictEqual([
      "advect",
      "curl",
      "confine",
      "buoyancy",
      "divergence",
      "pressure",
      "gradientSubtract",
      "advect",
    ]);
    expect(calls[3]).toStrictEqual(["buoyancy", "buoyancyPass:0:0"]);
    expect(calls[4]).toStrictEqual(["divergence", "divergencePass:1"]);
  });

  it("swaps the velocity face, so the projection reads what the lift wrote", () => {
    const calls = encode(0, 10);

    expect(calls[1]).toStrictEqual(["buoyancy", "buoyancyPass:1:0"]);
    expect(calls[2]).toStrictEqual(["divergence", "divergencePass:0"]);
  });

  it("runs no pass at strength 0", () => {
    expect(encode(0, 0).map(([pipeline]) => pipeline)).not.toContain(
      "buoyancy",
    );
  });

  it("runs the pass at a negative strength, which sinks hot dye", () => {
    expect(encode(0, -10).map(([pipeline]) => pipeline)).toContain("buoyancy");
  });
});

describe("encodeFrame's GPU timing", () => {
  const timing = (order: string[]): FrameTiming => {
    const querySet = "set";
    if (!isQuerySet(querySet)) throw new Error("unreachable");
    return {
      computeWrites: { querySet, beginningOfPassWriteIndex: 0 },
      renderWrites: { querySet, endOfPassWriteIndex: 1 },
      resolve: () => {
        order.push("resolve");
      },
    };
  };

  it("brackets the frame: the first slot opens the compute pass, the second closes the display pass", () => {
    const trace: Trace = {
      computeDescriptors: [],
      renderDescriptors: [],
      order: [],
    };
    encode(0, 0, timing(trace.order), trace);

    expect(trace.computeDescriptors).toStrictEqual([
      {
        timestampWrites: { querySet: "set", beginningOfPassWriteIndex: 0 },
      },
    ]);
    expect(trace.renderDescriptors[0]?.["timestampWrites"]).toStrictEqual({
      querySet: "set",
      endOfPassWriteIndex: 1,
    });
  });

  it("resolves the timestamps into the same submit, after the passes and before the encoder finishes", () => {
    const trace: Trace = {
      computeDescriptors: [],
      renderDescriptors: [],
      order: [],
    };
    encode(0, 0, timing(trace.order), trace);

    expect(trace.order).toStrictEqual(["resolve", "finish", "submit"]);
  });

  it("writes no timestamp when the frame is not timed", () => {
    const trace: Trace = {
      computeDescriptors: [],
      renderDescriptors: [],
      order: [],
    };
    encode(0, 0, null, trace);

    expect(trace.computeDescriptors).toStrictEqual([undefined]);
    expect(trace.renderDescriptors[0]).not.toHaveProperty("timestampWrites");
    expect(trace.order).toStrictEqual(["finish", "submit"]);
  });
});
