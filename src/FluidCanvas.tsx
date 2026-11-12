import { useEffect, useRef, useState } from "react";

import type { FrameReading } from "@/fluid/frameStats";
import { StatsMeter } from "@/fluid/frameStats";
import { GpuUnavailableError, initGpu } from "@/fluid/gpu";
import { GravityTracker } from "@/fluid/gravity";
import { watchGravity } from "@/fluid/gravityInput";
import { MotionGate, reducedMotionQuery } from "@/fluid/motion";
import { PointerTracker } from "@/fluid/pointer";
import { createFluidRenderer } from "@/fluid/renderer";
import { DEFAULT_RESOLUTION, sameResolution } from "@/fluid/resolution";
import { FrameSchedule } from "@/fluid/schedule";
import { seedEnabled, seedSplats } from "@/fluid/seed";
import { DEFAULT_SETTINGS } from "@/fluid/settings";
import { saveResolution } from "@/fluid/settingsStorage";
import type { FluidRenderer } from "@/fluid/types";
import { FrameReadout } from "@/FrameReadout";
import { GpuNotice } from "@/GpuNotice";
import { SettingsPanel } from "@/SettingsPanel";
import { useFluidSettings } from "@/useFluidSettings";

/** Cap the backing store on high-DPI displays: past 2x the extra pixels cost
 * fill rate without being visible. */
const MAX_PIXEL_RATIO = 2;

export const FluidCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Two fields rather than one message, because whether the resolution is worth
  // offering to reset is decided where the failure is caught, not where it renders.
  const [failure, setFailure] = useState<{
    message: string;
    resolutionSuspect: boolean;
  } | null>(null);
  const [reading, setReading] = useState<FrameReading | null>(null);
  const {
    settings,
    resolution,
    applySettings,
    applyResolution,
    rendererRef,
    pointerRef,
    settingsRef,
    resolutionRef,
  } = useFluidSettings();

  useEffect(() => {
    const canvas = canvasRef.current;
    // Only narrows the type: the canvas is mounted before any effect runs.
    /* v8 ignore next -- @preserve */
    if (canvas === null) return;

    const pointer = new PointerTracker();
    const gravity = new GravityTracker();
    const gravityWatch = watchGravity(window, gravity);
    pointer.setForce(settingsRef.current.splatForce);
    pointerRef.current = pointer;
    const motionQuery = reducedMotionQuery(window);
    const prefersReducedMotion = (): boolean => motionQuery?.matches ?? false;
    const motion = new MotionGate(prefersReducedMotion(), document.hidden);
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
      motion.requestMotion();
      pointer.press(event.pointerId, x, y);
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent): void => {
      const [x, y] = toNormalised(event);
      pointer.move(event.pointerId, x, y);
    };
    const onPointerUp = (event: PointerEvent): void => {
      // A touch press is no user activation to iOS Safari; its release is.
      if (event.type === "pointerup") void gravityWatch.requestPermission();
      pointer.release(event.pointerId);
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };
    // Needed because a browser-revoked capture delivers no pointerup, which
    // would strand the stroke active, splatting its last position every frame.
    const onLostPointerCapture = (event: PointerEvent): void => {
      pointer.release(event.pointerId);
    };

    const onVisibilityChange = (): void => {
      motion.setHidden(document.hidden);
    };

    const onMotionPreferenceChange = (): void => {
      motion.setReducedMotion(prefersReducedMotion());
    };

    // Keyboard and assistive-technology users never fire pointerdown, so without
    // this the reduced-motion hold would leave them a permanently blank canvas.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      motion.requestMotion();
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
      canvas.addEventListener("lostpointercapture", onLostPointerCapture);
      canvas.addEventListener("keydown", onKeyDown);
      document.addEventListener("visibilitychange", onVisibilityChange);
      motionQuery?.addEventListener?.("change", onMotionPreferenceChange);
      observer.observe(canvas);

      let previous = performance.now();
      const schedule = new FrameSchedule(
        motion.seeds && seedEnabled(window.location.search)
          ? seedSplats(Math.random)
          : [],
      );

      const meter = new StatsMeter(renderer, setReading);

      const loop = (now: number): void => {
        const elapsed = (now - previous) / 1000;
        previous = now;
        const { showStats } = settingsRef.current;

        if (!motion.open) {
          meter.update(now, showStats, false);
          frameId = requestAnimationFrame(loop);
          return;
        }

        const advanced = schedule.advance(elapsed, {
          consume: () => pointer.consume(),
          frame: (splats, dt) => renderer?.frame(splats, dt, gravity.step(dt)),
        });
        meter.update(now, showStats, advanced > 0);

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
      canvas.removeEventListener("lostpointercapture", onLostPointerCapture);
      canvas.removeEventListener("keydown", onKeyDown);
      gravityWatch.dispose();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      motionQuery?.removeEventListener?.("change", onMotionPreferenceChange);
      renderer?.destroy();
      rendererRef.current = null;
      pointerRef.current = null;
      gpuDevice?.destroy();
    };
  }, [pointerRef, rendererRef, resolutionRef, settingsRef]);

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
      <canvas ref={canvasRef} aria-label="Fluid simulation" tabIndex={0} />
      {settings.showStats && <FrameReadout reading={reading} />}
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
