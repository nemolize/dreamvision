import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_STEPS_PER_FRAME, TIME_STEP } from "@/fluid/config";
import { GpuUnavailableError, initGpu } from "@/fluid/gpu";
import { PointerTracker } from "@/fluid/pointer";
import { createFluidRenderer } from "@/fluid/renderer";
import { seedEnabled, seedSplats } from "@/fluid/seed";
import type { FluidSettings } from "@/fluid/settings";
import { DEFAULT_SETTINGS } from "@/fluid/settings";
import { loadSettings, saveSettings } from "@/fluid/settingsStorage";
import type { FluidRenderer, Splat } from "@/fluid/types";
import { SettingsPanel } from "@/SettingsPanel";

/** Cap the backing store on high-DPI displays: past 2x the extra pixels cost
 * fill rate without being visible. */
const MAX_PIXEL_RATIO = 2;

export const FluidCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<FluidSettings>(loadSettings);

  // Held in a ref as well as state: the simulation effect must not re-run —
  // and tear down the GPU device — every time a slider moves.
  const rendererRef = useRef<FluidRenderer | null>(null);
  const pointerRef = useRef<PointerTracker | null>(null);
  const settingsRef = useRef(settings);

  const applySettings = useCallback((next: FluidSettings) => {
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
    rendererRef.current?.applySettings(next);
    pointerRef.current?.setForce(next.splatForce);
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
        setError("The GPU device was lost. Reload to restart the simulation.");
      });

      const { width, height } = resizeCanvas();
      renderer = createFluidRenderer(device, context, format, width, height);
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
      setError(
        cause instanceof GpuUnavailableError
          ? cause.message
          : "The simulation could not start on this device.",
      );
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

  if (error !== null) {
    return (
      <p className="notice" role="alert">
        {error}
      </p>
    );
  }

  return (
    <>
      <canvas ref={canvasRef} aria-label="Fluid simulation" />
      <SettingsPanel
        settings={settings}
        onChange={applySettings}
        onReset={() => {
          applySettings(DEFAULT_SETTINGS);
        }}
      />
    </>
  );
};
