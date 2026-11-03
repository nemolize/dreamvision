import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SEED_SPLATS_MIN } from "@/fluid/config";
import type * as gpuModule from "@/fluid/gpu";
import { GpuUnavailableError } from "@/fluid/gpu";
import type { createFluidRenderer } from "@/fluid/renderer";
import { DEFAULT_RESOLUTION } from "@/fluid/resolution";
import { DEFAULT_SETTINGS } from "@/fluid/settings";
import {
  loadResolution,
  loadSettings,
  saveResolution,
} from "@/fluid/settingsStorage";
import type { FluidRenderer, Splat } from "@/fluid/types";
import { FluidCanvas } from "@/FluidCanvas";

const mocks = vi.hoisted(() => ({
  initGpu: vi.fn(),
  createFluidRenderer: vi.fn<typeof createFluidRenderer>(),
}));

vi.mock("@/fluid/gpu", async (importOriginal) => ({
  ...(await importOriginal<typeof gpuModule>()),
  initGpu: mocks.initGpu,
}));
vi.mock("@/fluid/renderer", () => ({
  createFluidRenderer: mocks.createFluidRenderer,
}));

const RAISED_RESOLUTION = { ...DEFAULT_RESOLUTION, simResolution: 192 };

interface FakeGpu {
  device: { destroy: ReturnType<typeof vi.fn>; lost: Promise<unknown> };
  lose: (reason: GPUDeviceLostReason) => void;
}

const fakeGpu = (): FakeGpu => {
  let settle: (info: {
    reason: GPUDeviceLostReason;
    message: string;
  }) => void = () => undefined;
  const lost = new Promise<{ reason: GPUDeviceLostReason; message: string }>(
    (resolve) => {
      settle = resolve;
    },
  );
  return {
    device: { destroy: vi.fn(), lost },
    lose: (reason) => {
      settle({ reason, message: "" });
    },
  };
};

const fakeRenderer = (): FluidRenderer => ({
  frame: vi.fn(),
  applySettings: vi.fn(),
  setResolution: vi.fn(),
  resize: vi.fn(),
  destroy: vi.fn(),
});

const capture = {
  set: vi.fn(),
  release: vi.fn(),
  has: vi.fn(),
};

let gpus: FakeGpu[];
let renderers: FluidRenderer[];
let frames: Map<number, FrameRequestCallback>;
let clock: number;
let resizeObservers: {
  callback: () => void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}[];

const newGpu = (): FakeGpu => {
  const gpu = fakeGpu();
  gpus.push(gpu);
  return gpu;
};

const gpuContext = (gpu: FakeGpu) => ({
  device: gpu.device,
  context: {},
  format: "bgra8unorm",
});

const settle = (): Promise<void> =>
  act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });

const mount = async (ui: ReactNode = <FluidCanvas />) => {
  const view = render(ui);
  await settle();
  return view;
};

const runFrame = (milliseconds = 16): void => {
  const queued = [...frames.values()];
  frames.clear();
  clock = Math.max(clock, performance.now()) + milliseconds;
  for (const callback of queued) callback(clock);
};

const getCanvas = (): HTMLCanvasElement => {
  const canvas = screen.getByLabelText("Fluid simulation");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("expected the labelled element to be a canvas");
  }
  return canvas;
};

const onlyRenderer = (): FluidRenderer => {
  const [first, ...rest] = renderers;
  if (first === undefined || rest.length > 0) {
    throw new Error(`expected one renderer, got ${String(renderers.length)}`);
  }
  return first;
};

const splatsOfFrame = (renderer: FluidRenderer, call: number): Splat[] => {
  const calls = vi.mocked(renderer.frame).mock.calls;
  const splats = calls[call]?.[0];
  if (splats === undefined) throw new Error("expected that frame to be drawn");
  return [...splats];
};

const stubMotionQuery = (matches: boolean) => {
  const listeners: (() => void)[] = [];
  const query = {
    matches,
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.push(listener);
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );
  return { query, listeners };
};

const setDocumentHidden = (hidden: boolean): void => {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

const openPanel = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
};

beforeEach(() => {
  gpus = [];
  renderers = [];
  frames = new Map();
  clock = 0;
  resizeObservers = [];
  window.localStorage.clear();
  window.history.replaceState({}, "", "/?seed=off");

  mocks.initGpu.mockReset();
  mocks.initGpu.mockImplementation(() => Promise.resolve(gpuContext(newGpu())));
  mocks.createFluidRenderer.mockReset();
  mocks.createFluidRenderer.mockImplementation(() => {
    const renderer = fakeRenderer();
    renderers.push(renderer);
    return renderer;
  });

  let nextFrame = 0;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
    (callback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    },
  );
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });

  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: () => void;
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: () => void) {
        this.callback = callback;
        resizeObservers.push(this);
      }
    },
  );

  // happy-dom lays nothing out and has no pointer capture.
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockReturnValue(new DOMRect(0, 0, 100, 100));
  capture.set = vi.fn();
  capture.release = vi.fn();
  capture.has = vi.fn(() => true);
  Object.defineProperties(HTMLCanvasElement.prototype, {
    setPointerCapture: { configurable: true, value: capture.set },
    releasePointerCapture: { configurable: true, value: capture.release },
    hasPointerCapture: { configurable: true, value: capture.has },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "hidden");
  window.history.replaceState({}, "", "/");
});

describe("FluidCanvas teardown", () => {
  it("destroys the renderer and the device once each and stops the loop", async () => {
    const { unmount } = await mount();
    const [gpu] = gpus;
    expect(frames.size).toBe(1);

    unmount();

    expect(onlyRenderer().destroy).toHaveBeenCalledTimes(1);
    expect(gpu?.device.destroy).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(resizeObservers[0]?.disconnect).toHaveBeenCalledTimes(1);
  });

  it("removes every listener it added to the canvas and the document", async () => {
    const view = render(<FluidCanvas />);
    const canvas = getCanvas();
    const canvasAdd = vi.spyOn(canvas, "addEventListener");
    const canvasRemove = vi.spyOn(canvas, "removeEventListener");
    const documentAdd = vi.spyOn(document, "addEventListener");
    const documentRemove = vi.spyOn(document, "removeEventListener");
    await settle();

    view.unmount();

    expect(canvasAdd.mock.calls.map(([type]) => type).sort()).toEqual([
      "keydown",
      "lostpointercapture",
      "pointercancel",
      "pointerdown",
      "pointermove",
      "pointerup",
    ]);
    expect(canvasRemove.mock.calls).toEqual(canvasAdd.mock.calls);
    expect(documentRemove.mock.calls).toEqual(
      documentAdd.mock.calls.filter(([type]) => type === "visibilitychange"),
    );
  });

  it("detaches the motion-preference listener it attached", async () => {
    const { query, listeners } = stubMotionQuery(false);
    const { unmount } = await mount();
    expect(listeners).toHaveLength(1);

    unmount();

    expect(query.removeEventListener).toHaveBeenCalledWith(
      "change",
      listeners[0],
    );
  });

  it("flushes a settings save still waiting on its debounce", async () => {
    const { unmount } = await mount();
    vi.useFakeTimers();
    openPanel();
    fireEvent.change(screen.getByRole("slider", { name: "Splat force" }), {
      target: { value: "20" },
    });
    expect(loadSettings().splatForce).toBe(DEFAULT_SETTINGS.splatForce);

    unmount();

    expect(loadSettings().splatForce).toBe(20);
  });
});

describe("FluidCanvas start-up races", () => {
  it("leaves one live device and renderer when StrictMode double-invokes the effect", async () => {
    const { unmount } = await mount(
      <StrictMode>
        <FluidCanvas />
      </StrictMode>,
    );

    expect(gpus).toHaveLength(2);
    expect(gpus[0]?.device.destroy).toHaveBeenCalledTimes(1);
    expect(gpus[1]?.device.destroy).not.toHaveBeenCalled();
    expect(mocks.createFluidRenderer).toHaveBeenCalledTimes(1);
    expect(onlyRenderer().destroy).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();

    unmount();

    expect(gpus[1]?.device.destroy).toHaveBeenCalledTimes(1);
    expect(onlyRenderer().destroy).toHaveBeenCalledTimes(1);
  });

  it("ignores a failure from the effect StrictMode discarded", async () => {
    mocks.initGpu.mockImplementationOnce(() =>
      Promise.reject(new Error("the discarded effect failed")),
    );

    await mount(
      <StrictMode>
        <FluidCanvas />
      </StrictMode>,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.createFluidRenderer).toHaveBeenCalledTimes(1);
  });

  it("destroys the device an init that resolves after unmount returns, and builds nothing on it", async () => {
    let resolveInit: (gpu: FakeGpu) => void = () => undefined;
    mocks.initGpu.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInit = (gpu) => {
            resolve(gpuContext(gpu));
          };
        }),
    );
    const { unmount } = render(<FluidCanvas />);
    unmount();

    const gpu = newGpu();
    resolveInit(gpu);
    await settle();

    expect(gpu.device.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.createFluidRenderer).not.toHaveBeenCalled();
  });

  it("does not let a device lost before a remount fail the remounted canvas", async () => {
    const tree = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <FluidCanvas />
      </Activity>
    );
    const view = await mount(tree("visible"));
    const first = gpus[0];

    view.rerender(tree("hidden"));
    view.rerender(tree("visible"));
    await settle();
    first?.lose("unknown");
    await settle();

    expect(gpus).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("FluidCanvas device loss", () => {
  it("offers only a reload when the lost device ran at the default resolution", async () => {
    await mount();
    expect(frames.size).toBe(1);

    await act(async () => {
      gpus[0]?.lose("unknown");
      await Promise.resolve();
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "The GPU device was lost. Reload to restart the simulation.",
    );
    expect(
      screen.queryByRole("button", { name: /Reset resolution/ }),
    ).toBeNull();
    expect(frames.size).toBe(0);
  });

  it("offers a resolution reset when the lost device ran at a raised resolution", async () => {
    saveResolution(RAISED_RESOLUTION);
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => undefined);
    await mount();

    await act(async () => {
      gpus[0]?.lose("unknown");
      await Promise.resolve();
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "The grid resolution may be more than this device can hold.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reset resolution and reload" }),
    );

    expect(loadResolution()).toEqual(DEFAULT_RESOLUTION);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows no notice for a device the app destroyed itself", async () => {
    await mount();

    await act(async () => {
      gpus[0]?.lose("destroyed");
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(frames.size).toBe(1);
  });

  it("shows no notice for a device lost after unmount", async () => {
    const { unmount, container } = await mount();
    unmount();

    await act(async () => {
      gpus[0]?.lose("unknown");
      await Promise.resolve();
    });

    expect(container.querySelector("[role=alert]")).toBeNull();
  });
});

describe("FluidCanvas start-up failure", () => {
  it("shows an unavailable GPU's own message, with no reset", async () => {
    saveResolution(RAISED_RESOLUTION);
    mocks.initGpu.mockRejectedValueOnce(
      new GpuUnavailableError("No GPU adapter is available on this device."),
    );

    await mount();

    expect(screen.getByRole("alert").textContent).toBe(
      "No GPU adapter is available on this device.",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names a failed build generically, with no reset at the default resolution", async () => {
    mocks.createFluidRenderer.mockImplementationOnce(() => {
      throw new Error("out of memory");
    });

    await mount();

    expect(screen.getByRole("alert").textContent).toBe(
      "The simulation could not start on this device.",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the reset when a build failed at a raised resolution", async () => {
    saveResolution(RAISED_RESOLUTION);
    mocks.createFluidRenderer.mockImplementationOnce(() => {
      throw new Error("out of memory");
    });

    await mount();

    expect(
      screen.getByRole("button", { name: "Reset resolution and reload" }),
    ).toBeTruthy();
  });
});

describe("FluidCanvas frame loop", () => {
  it("builds the renderer at the stored resolution and applies the stored settings", async () => {
    saveResolution(RAISED_RESOLUTION);
    await mount();

    const [, , , width, height, resolution] =
      mocks.createFluidRenderer.mock.calls[0] ?? [];
    expect([width, height]).toEqual([1, 1]);
    expect(resolution).toEqual(RAISED_RESOLUTION);
    expect(onlyRenderer().applySettings).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it("opens with a seed burst unless the page asks for none", async () => {
    window.history.replaceState({}, "", "/");
    await mount();

    runFrame();

    expect(splatsOfFrame(onlyRenderer(), 0).length).toBeGreaterThanOrEqual(
      SEED_SPLATS_MIN,
    );
  });

  it("draws an empty first frame when seeding is off", async () => {
    await mount();

    runFrame();

    expect(splatsOfFrame(onlyRenderer(), 0)).toEqual([]);
  });

  it("draws a drag as a splat and stops at pointerup", async () => {
    await mount();
    const canvas = getCanvas();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 30, clientY: 20 });
    runFrame();
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    runFrame();
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 50, clientY: 50 });
    runFrame();

    const renderer = onlyRenderer();
    expect(splatsOfFrame(renderer, 0)).toHaveLength(1);
    expect(splatsOfFrame(renderer, 0)[0]?.dx).toBeGreaterThan(0);
    expect(capture.set).toHaveBeenCalledWith(1);
    expect(capture.release).toHaveBeenCalledWith(1);
    expect(splatsOfFrame(renderer, 2)).toEqual([]);
  });

  it("does not release a capture the browser already took back", async () => {
    await mount();
    const canvas = getCanvas();
    capture.has.mockReturnValue(false);

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(canvas, { pointerId: 1 });

    expect(capture.release).not.toHaveBeenCalled();
  });

  it("ends a stroke whose capture was revoked without a pointerup", async () => {
    await mount();
    const canvas = getCanvas();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.lostPointerCapture(canvas, { pointerId: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 30, clientY: 30 });
    runFrame();

    expect(splatsOfFrame(onlyRenderer(), 0)).toEqual([]);
  });

  it("holds the loop under reduced motion until Enter or Space asks for motion", async () => {
    stubMotionQuery(true);
    await mount();
    const canvas = getCanvas();

    runFrame();
    expect(onlyRenderer().frame).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(canvas, { key: "a" })).toBe(true);
    runFrame();
    expect(onlyRenderer().frame).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(canvas, { key: " " })).toBe(false);
    runFrame();
    expect(onlyRenderer().frame).toHaveBeenCalledTimes(1);
  });

  it("lifts the reduced-motion hold on Enter as well", async () => {
    stubMotionQuery(true);
    await mount();

    expect(fireEvent.keyDown(getCanvas(), { key: "Enter" })).toBe(false);
    runFrame();

    expect(onlyRenderer().frame).toHaveBeenCalledTimes(1);
  });

  it("scales a drag by the stored splat force", async () => {
    window.localStorage.setItem(
      "dreamvision.settings",
      JSON.stringify({ ...DEFAULT_SETTINGS, splatForce: 20 }),
    );
    await mount();
    const canvas = getCanvas();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 30, clientY: 10 });
    runFrame();

    expect(splatsOfFrame(onlyRenderer(), 0)[0]?.dx).toBeCloseTo(0.2 * 20);
  });

  it("scales a drag by a splat force moved after mount", async () => {
    await mount();
    openPanel();
    fireEvent.change(screen.getByRole("slider", { name: "Splat force" }), {
      target: { value: "20" },
    });
    const canvas = getCanvas();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 30, clientY: 10 });
    runFrame();

    expect(splatsOfFrame(onlyRenderer(), 0)[0]?.dx).toBeCloseTo(0.2 * 20);
  });

  it("lifts the reduced-motion hold on a pointer press", async () => {
    stubMotionQuery(true);
    await mount();

    fireEvent.pointerDown(getCanvas(), {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    runFrame();

    expect(onlyRenderer().frame).toHaveBeenCalledTimes(1);
  });

  it("re-arms the hold when the preference is switched on mid-session", async () => {
    const { query, listeners } = stubMotionQuery(false);
    await mount();
    runFrame();
    expect(onlyRenderer().frame).toHaveBeenCalledTimes(1);

    query.matches = true;
    listeners.forEach((listener) => {
      listener();
    });
    runFrame();

    expect(onlyRenderer().frame).toHaveBeenCalledTimes(1);
  });

  it("runs when the browser has no matchMedia", async () => {
    vi.stubGlobal("matchMedia", undefined);
    await mount();

    runFrame();

    expect(onlyRenderer().frame).toHaveBeenCalledTimes(1);
  });

  it("runs when the media query cannot report changes", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    const { unmount } = await mount();

    runFrame();
    unmount();

    expect(onlyRenderer().frame).toHaveBeenCalledTimes(1);
  });

  it("does not draw in a tab that opens hidden", async () => {
    setDocumentHidden(true);
    await mount();

    runFrame();

    expect(onlyRenderer().frame).not.toHaveBeenCalled();
  });

  it("skips drawing while the tab is hidden and resumes when it returns", async () => {
    await mount();

    setDocumentHidden(true);
    runFrame();
    expect(onlyRenderer().frame).not.toHaveBeenCalled();

    setDocumentHidden(false);
    runFrame();
    expect(onlyRenderer().frame).toHaveBeenCalledTimes(1);
  });

  it("resizes the renderer to the canvas at no more than twice the pixel ratio", async () => {
    vi.stubGlobal("devicePixelRatio", 3);
    await mount();
    const canvas = getCanvas();
    Object.defineProperty(canvas, "clientWidth", { value: 300 });
    Object.defineProperty(canvas, "clientHeight", { value: 150 });

    resizeObservers[0]?.callback();

    expect(onlyRenderer().resize).toHaveBeenCalledWith(600, 300);
    expect([canvas.width, canvas.height]).toEqual([600, 300]);
    expect(resizeObservers[0]?.observe).toHaveBeenCalledWith(canvas);
  });
});

describe("FluidCanvas settings", () => {
  it("applies a moved slider at once and stores only where it came to rest", async () => {
    await mount();
    vi.useFakeTimers();
    openPanel();
    const force = screen.getByRole("slider", { name: "Splat force" });

    fireEvent.change(force, { target: { value: "20" } });
    fireEvent.change(force, { target: { value: "30" } });

    expect(onlyRenderer().applySettings).toHaveBeenLastCalledWith({
      ...DEFAULT_SETTINGS,
      splatForce: 30,
    });
    expect(loadSettings().splatForce).toBe(DEFAULT_SETTINGS.splatForce);

    vi.advanceTimersByTime(200);
    expect(loadSettings().splatForce).toBe(30);
  });

  it("stores a pending change on pagehide, and does nothing on a second one", async () => {
    await mount();
    vi.useFakeTimers();
    openPanel();
    fireEvent.change(screen.getByRole("slider", { name: "Splat force" }), {
      target: { value: "20" },
    });

    window.dispatchEvent(new Event("pagehide"));
    expect(loadSettings().splatForce).toBe(20);

    window.localStorage.clear();
    window.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(200);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("rebuilds at a committed resolution, stores it, and resets both on Reset", async () => {
    await mount();
    openPanel();
    const sim = screen.getByRole("slider", { name: "Sim grid" });

    fireEvent.change(sim, { target: { value: "192" } });
    fireEvent.pointerUp(sim);

    const renderer = onlyRenderer();
    expect(renderer.setResolution).toHaveBeenLastCalledWith(RAISED_RESOLUTION);
    expect(loadResolution()).toEqual(RAISED_RESOLUTION);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(renderer.applySettings).toHaveBeenLastCalledWith(DEFAULT_SETTINGS);
    expect(renderer.setResolution).toHaveBeenLastCalledWith(DEFAULT_RESOLUTION);
    expect(loadResolution()).toEqual(DEFAULT_RESOLUTION);
  });
});
