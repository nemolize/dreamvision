import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PointerTracker } from "@/fluid/pointer";
import { DEFAULT_RESOLUTION } from "@/fluid/resolution";
import { DEFAULT_SETTINGS } from "@/fluid/settings";
import { loadResolution, loadSettings } from "@/fluid/settingsStorage";
import type { FluidRenderer } from "@/fluid/types";
import { useFluidSettings } from "@/useFluidSettings";

const RAISED_RESOLUTION = { ...DEFAULT_RESOLUTION, simResolution: 192 };

const fakeRenderer = (): FluidRenderer => ({
  frame: vi.fn(),
  applySettings: vi.fn(),
  setResolution: vi.fn(),
  resize: vi.fn(),
  measureGpu: vi.fn(),
  destroy: vi.fn(),
});

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useFluidSettings settings", () => {
  it("starts from the stored settings and resolution", () => {
    window.localStorage.clear();
    const { result } = renderHook(() => useFluidSettings());

    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.current.resolution).toEqual(DEFAULT_RESOLUTION);
    expect(result.current.settingsRef.current).toEqual(DEFAULT_SETTINGS);
    expect(result.current.resolutionRef.current).toEqual(DEFAULT_RESOLUTION);
  });

  it("applies a moved slider at once and stores only where it came to rest", () => {
    const { result } = renderHook(() => useFluidSettings());

    act(() => {
      result.current.applySettings({ ...DEFAULT_SETTINGS, splatForce: 20 });
    });
    act(() => {
      result.current.applySettings({ ...DEFAULT_SETTINGS, splatForce: 30 });
    });

    expect(result.current.settings.splatForce).toBe(30);
    expect(result.current.settingsRef.current.splatForce).toBe(30);
    expect(loadSettings().splatForce).toBe(DEFAULT_SETTINGS.splatForce);

    vi.advanceTimersByTime(200);
    expect(loadSettings().splatForce).toBe(30);
  });

  it("hands each applied setting to the renderer and the pointer when they are attached", () => {
    const { result } = renderHook(() => useFluidSettings());
    const renderer = fakeRenderer();
    const pointer = new PointerTracker();
    const setForce = vi.spyOn(pointer, "setForce");
    result.current.rendererRef.current = renderer;
    result.current.pointerRef.current = pointer;
    const next = { ...DEFAULT_SETTINGS, splatForce: 20 };

    act(() => {
      result.current.applySettings(next);
    });

    expect(renderer.applySettings).toHaveBeenCalledWith(next);
    expect(setForce).toHaveBeenCalledWith(20);
  });

  it("flushes a save still waiting on its debounce when it unmounts", () => {
    const { result, unmount } = renderHook(() => useFluidSettings());
    act(() => {
      result.current.applySettings({ ...DEFAULT_SETTINGS, splatForce: 20 });
    });
    expect(loadSettings().splatForce).toBe(DEFAULT_SETTINGS.splatForce);

    unmount();

    expect(loadSettings().splatForce).toBe(20);
  });

  it("stores a pending change on pagehide, and does nothing on a second one", () => {
    const { result } = renderHook(() => useFluidSettings());
    act(() => {
      result.current.applySettings({ ...DEFAULT_SETTINGS, splatForce: 20 });
    });

    window.dispatchEvent(new Event("pagehide"));
    expect(loadSettings().splatForce).toBe(20);

    window.localStorage.clear();
    window.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(200);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("useFluidSettings resolution", () => {
  it("applies a resolution at once and stores it without a debounce", () => {
    const { result } = renderHook(() => useFluidSettings());
    const renderer = fakeRenderer();
    result.current.rendererRef.current = renderer;

    act(() => {
      result.current.applyResolution(RAISED_RESOLUTION);
    });

    expect(result.current.resolution).toEqual(RAISED_RESOLUTION);
    expect(result.current.resolutionRef.current).toEqual(RAISED_RESOLUTION);
    expect(renderer.setResolution).toHaveBeenCalledWith(RAISED_RESOLUTION);
    expect(loadResolution()).toEqual(RAISED_RESOLUTION);
  });

  it("applies a resolution before any renderer is attached", () => {
    const { result } = renderHook(() => useFluidSettings());

    act(() => {
      result.current.applyResolution(RAISED_RESOLUTION);
    });

    expect(loadResolution()).toEqual(RAISED_RESOLUTION);
  });
});
