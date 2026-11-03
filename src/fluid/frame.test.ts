import { describe, expect, it } from "vitest";

import type { FrameEncode } from "./frame";
import { encodeFrame } from "./frame";

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

const faces = (name: string): readonly [string, string] => [
  `${name}:0`,
  `${name}:1`,
];

const encode = (vorticityConfinement: number): Call[] => {
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
      beginComputePass: () => pass,
      beginRenderPass: () => display,
      finish: () => "commands",
    }),
    queue: { submit: () => undefined },
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
