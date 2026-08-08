import { useEffect, useRef, useState } from "react";

import { GpuUnavailableError, initGpu } from "@/fluid/gpu";
import { PointerTracker } from "@/fluid/pointer";
import { createFluidRenderer } from "@/fluid/renderer";
import type { FluidRenderer } from "@/fluid/types";

/** Cap the backing store on high-DPI displays: past 2x the extra pixels cost
 * fill rate without being visible. */
const MAX_PIXEL_RATIO = 2;

export const FluidCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const pointer = new PointerTracker();
    let renderer: FluidRenderer | null = null;
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

      const { width, height } = resizeCanvas();
      renderer = createFluidRenderer(device, context, format, width, height);

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);
      observer.observe(canvas);

      const loop = (): void => {
        renderer?.frame(pointer.consume());
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
    };
  }, []);

  if (error !== null) {
    return (
      <p className="notice" role="alert">
        {error}
      </p>
    );
  }

  return <canvas ref={canvasRef} aria-label="Fluid simulation" />;
};
