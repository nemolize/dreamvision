import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_STEPS_PER_FRAME, TIME_STEP } from "@/fluid/config";
import { GpuUnavailableError, initGpu } from "@/fluid/gpu";
import { PointerTracker } from "@/fluid/pointer";
import { createFluidRenderer } from "@/fluid/renderer";
import type { ResolutionSettings } from "@/fluid/resolution";
import { DEFAULT_RESOLUTION, sameResolution } from "@/fluid/resolution";
import { seedEnabled, seedSplats } from "@/fluid/seed";
import type { FluidSettings } from "@/fluid/settings";
import { DEFAULT_SETTINGS } from "@/fluid/settings";
import {
  loadResolution,
  loadSettings,
  saveResolution,
  saveSettings,
} from "@/fluid/settingsStorage";
import type { FluidRenderer, Splat } from "@/fluid/types";
import { GpuNotice } from "@/GpuNotice";
import { SettingsPanel } from "@/SettingsPanel";

/** Cap the backing store on high-DPI displays: past 2x the extra pixels cost
 * fill rate without being visible. */
const MAX_PIXEL_RATIO = 2;

const SAVE_DEBOUNCE_MS = 200;

export const FluidCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Two fields rather than one message, because whether the resolution is worth
  // offering to reset is decided where the failure is caught, not where it renders.
  const [failure, setFailure] = useState<{
    message: string;
    resolutionSuspect: boolean;
  } | null>(null);
  const [settings, setSettings] = useState<FluidSettings>(loadSettings);
  const [resolution, setResolution] =
    useState<ResolutionSettings>(loadResolution);

  // Held in a ref as well as state: the simulation effect must not re-run —
  // and tear down the GPU device — every time a slider moves.
  const rendererRef = useRef<FluidRenderer | null>(null);
  const pointerRef = useRef<PointerTracker | null>(null);
  const settingsRef = useRef(settings);
  const resolutionRef = useRef(resolution);

  const saveTimerRef = useRef<number | null>(null);

  const applySettings = useCallback((next: FluidSettings) => {
    settingsRef.current = next;
    setSettings(next);
    rendererRef.current?.applySettings(next);
    pointerRef.current?.setForce(next.splatForce);

    // Debounced because a dragged slider fires per pointer move; only the value
    // it rests on has to be stored, while the lines above take every one.
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      saveSettings(settingsRef.current);
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // Undebounced, unlike the settings above: the panel only reports a resolution
  // once the drag ends, so there is no per-move burst to collapse.
  const applyResolution = useCallback((next: ResolutionSettings) => {
    resolutionRef.current = next;
    setResolution(next);
    rendererRef.current?.setResolution(next);
    saveResolution(next);
  }, []);

  // Flushed on hide because a pending save would otherwise be lost to a tab
  // closed mid-drag; `pagehide` is the last event a bfcache-eligible page gets.
  useEffect(() => {
    const flush = (): void => {
      if (saveTimerRef.current === null) return;
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      saveSettings(settingsRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const pointer = new PointerTracker();
    pointer.setForce(settingsRef.current.splatForce);
    pointerRef.current = pointer;
    let renderer: FluidRenderer | null = null;
    let gpuDevice: GPUDevice | null = null;
    let frameId = 0;
    let disposed = false;

    const toNormalised = (event: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height,
      ];
    };

    const onPointerDown = (event: PointerEvent): void => {
      const [x, y] = toNormalised(event);
      pointer.press(x, y);
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent): void => {
      const [x, y] = toNormalised(event);
      pointer.move(x, y);
    };
    const onPointerUp = (): void => {
      pointer.release();
    };

    const resizeCanvas = (): { width: number; height: number } => {
      const ratio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      canvas.width = width;
      canvas.height = height;
      return { width, height };
    };

    const observer = new ResizeObserver(() => {
      const { width, height } = resizeCanvas();
      renderer?.resize(width, height);
    });

    const start = async (): Promise<void> => {
      const { device, context, format } = await initGpu(canvas);
      if (disposed) {
        device.destroy();
        return;
      }
      gpuDevice = device;

      // A lost device (driver reset, GPU eviction) leaves the loop submitting
      // to a dead device forever — the canvas would just freeze silently.
      void device.lost.then((info) => {
        if (disposed || info.reason === "destroyed") return;
        cancelAnimationFrame(frameId);
        // A device lost at a raised resolution otherwise dead-ends: the value is
        // already persisted, so every reload rebuilds at the size that lost it.
        const suspect = !sameResolution(
          resolutionRef.current,
          DEFAULT_RESOLUTION,
        );
        setFailure({
          message: suspect
            ? "The GPU device was lost. The grid resolution may be more than this device can hold."
            : "The GPU device was lost. Reload to restart the simulation.",
          resolutionSuspect: suspect,
        });
      });

      const { width, height } = resizeCanvas();
      renderer = createFluidRenderer(
        device,
        context,
        format,
        width,
        height,
        resolutionRef.current,
      );
      renderer.applySettings(settingsRef.current);
      rendererRef.current = renderer;

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);
      observer.observe(canvas);

      let previous = performance.now();
      let owed = 0;
      // Held until the first step runs: the loop may render before enough time
      // has accumulated for a step, and the burst has to land inside one.
      let pending: Splat[] = seedEnabled(window.location.search)
        ? seedSplats(Math.random)
        : [];

      const loop = (now: number): void => {
        owed += (now - previous) / 1000;
        previous = now;

        const steps = Math.min(
          Math.floor(owed / TIME_STEP),
          MAX_STEPS_PER_FRAME,
        );
        owed -= steps * TIME_STEP;

        const dragged = pointer.consume();
        if (dragged !== null) pending.push(dragged);

        for (let step = 0; step < steps; step++) {
          // Drained into the first step that runs: replaying the frame's splats
          // on each catch-up step would multiply their force by however far
          // behind the loop had fallen.
          renderer?.frame(pending);
          pending = [];
        }

        frameId = requestAnimationFrame(loop);
      };
      frameId = requestAnimationFrame(loop);
    };

    void start().catch((cause: unknown) => {
      if (disposed) return;
      // A raised resolution can fail the build itself, not only the running
      // device, and lands in the same reload loop — so it gets the same escape.
      const unavailable = cause instanceof GpuUnavailableError;
      setFailure({
        message: unavailable
          ? cause.message
          : "The simulation could not start on this device.",
        resolutionSuspect:
          !unavailable &&
          !sameResolution(resolutionRef.current, DEFAULT_RESOLUTION),
      });
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      renderer?.destroy();
      rendererRef.current = null;
      pointerRef.current = null;
      gpuDevice?.destroy();
    };
  }, []);

  if (failure !== null) {
    return (
      <GpuNotice
        message={failure.message}
        {...(failure.resolutionSuspect && {
          onResetResolution: () => {
            saveResolution(DEFAULT_RESOLUTION);
            window.location.reload();
          },
        })}
      />
    );
  }

  return (
    <>
      <canvas ref={canvasRef} aria-label="Fluid simulation" />
      <SettingsPanel
        settings={settings}
        resolution={resolution}
        onChange={applySettings}
        onResolutionChange={applyResolution}
        onReset={() => {
          applySettings(DEFAULT_SETTINGS);
          applyResolution(DEFAULT_RESOLUTION);
        }}
      />
    </>
  );
};
