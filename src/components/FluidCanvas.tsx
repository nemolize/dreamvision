"use client";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { FluidSimulation } from "@/lib/fluid-simulation";

interface FluidCanvasProps {
  width?: number;
  height?: number;
  scale?: number;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Offscreen buffer at simulation resolution, reused across frames. */
interface RenderBuffer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
}

const MOBILE_BREAKPOINT_PX = 768;
const DEFAULT_VISCOSITY = 0.0001;
const DEFAULT_DIFFUSION = 0.0001;

const createRenderBuffer = (
  width: number,
  height: number,
): RenderBuffer | null => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx == null) return null;
  return { canvas, ctx, image: ctx.createImageData(width, height) };
};

/**
 * Paint the density field into the buffer at simulation resolution, then
 * upscale via drawImage — far fewer pixel writes than filling the scaled
 * canvas cell by cell, with bilinear smoothing for free.
 */
const renderFrame = (
  target: HTMLCanvasElement,
  targetCtx: CanvasRenderingContext2D,
  buffer: RenderBuffer,
  simulation: FluidSimulation,
  simWidth: number,
  simHeight: number,
): void => {
  const data = buffer.image.data;
  const { r, g, b } = simulation.getDensityArrays();
  const stride = simWidth + 2;

  let pixel = 0;
  for (let j = 0; j < simHeight; j++) {
    let index = 1 + stride * (j + 1);
    for (let i = 0; i < simWidth; i++, index++, pixel += 4) {
      // Uint8ClampedArray clamps and rounds on assignment.
      data[pixel] = r[index] ?? 0;
      data[pixel + 1] = g[index] ?? 0;
      data[pixel + 2] = b[index] ?? 0;
      data[pixel + 3] = 255;
    }
  }

  buffer.ctx.putImageData(buffer.image, 0, 0);
  targetCtx.imageSmoothingEnabled = true;
  targetCtx.drawImage(buffer.canvas, 0, 0, target.width, target.height);
};

const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`;

const subscribeToMediaQuery = (onStoreChange: () => void) => {
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
};

const useIsMobile = (): boolean =>
  useSyncExternalStore(
    subscribeToMediaQuery,
    () => window.matchMedia(MOBILE_MEDIA_QUERY).matches,
    () => false,
  );

const randomColor = (): RGB => ({
  r: Math.random() * 255,
  g: Math.random() * 255,
  b: Math.random() * 255,
});

export const FluidCanvas = ({
  width = 120,
  height = 80,
  scale = 6,
}: FluidCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulationRef = useRef<FluidSimulation | null>(null);

  // Pointer interaction state lives in refs: it changes on every pointermove
  // and must not trigger React re-renders.
  const pointerActiveRef = useRef(false);
  const prevPosRef = useRef({ x: 0, y: 0 });
  const colorRef = useRef<RGB>(randomColor());
  const paramsRef = useRef({
    viscosity: DEFAULT_VISCOSITY,
    diffusion: DEFAULT_DIFFUSION,
  });

  const [isRunning, setIsRunning] = useState(true);
  const [viscosity, setViscosity] = useState(DEFAULT_VISCOSITY);
  const [diffusion, setDiffusion] = useState(DEFAULT_DIFFUSION);

  const isMobile = useIsMobile();

  // Responsive dimensions
  const canvasWidth = isMobile ? 80 : width;
  const canvasHeight = isMobile ? 60 : height;
  const canvasScale = isMobile ? 4 : scale;

  // Re-create the simulation only when the grid size changes; parameter
  // tweaks go through the setters so slider input doesn't reset the fluid.
  useEffect(() => {
    const simulation = new FluidSimulation(canvasWidth, canvasHeight);
    simulation.setViscosity(paramsRef.current.viscosity);
    simulation.setDiffusion(paramsRef.current.diffusion);
    simulationRef.current = simulation;
  }, [canvasWidth, canvasHeight]);

  // Animation loop: step the simulation and repaint on each animation frame.
  useEffect(() => {
    if (!isRunning) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    const buffer = createRenderBuffer(canvasWidth, canvasHeight);
    if (canvas == null || ctx == null || buffer == null) return;

    let animationId = 0;
    const animate = () => {
      const simulation = simulationRef.current;
      if (simulation != null) {
        simulation.step();
        renderFrame(canvas, ctx, buffer, simulation, canvasWidth, canvasHeight);
      }
      animationId = requestAnimationFrame(animate);
    };
    animationId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationId);
  }, [isRunning, canvasWidth, canvasHeight]);

  /** Map a pointer event to simulation-grid coordinates (CSS-scale aware). */
  const getCellPosition = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas == null) return null;

      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(
        ((e.clientX - rect.left) / rect.width) * canvasWidth,
      );
      const y = Math.floor(
        ((e.clientY - rect.top) / rect.height) * canvasHeight,
      );
      return { x, y };
    },
    [canvasWidth, canvasHeight],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const position = getCellPosition(e);
      if (position == null) return;

      pointerActiveRef.current = true;
      colorRef.current = randomColor();
      prevPosRef.current = position;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [getCellPosition],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!pointerActiveRef.current) return;

      const simulation = simulationRef.current;
      const position = getCellPosition(e);
      if (simulation == null || position == null) return;

      const isTouch = e.pointerType === "touch";
      const forceScale = isTouch ? 0.8 : 0.5;
      const neighborFalloff = isTouch ? 0.7 : 0.5;
      const radius = isTouch ? 2 : 1;

      const forceX = (position.x - prevPosRef.current.x) * forceScale;
      const forceY = (position.y - prevPosRef.current.y) * forceScale;

      if (
        position.x >= 0 &&
        position.x < canvasWidth &&
        position.y >= 0 &&
        position.y < canvasHeight
      ) {
        const { r, g, b } = colorRef.current;
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dy = -radius; dy <= radius; dy++) {
            const nx = position.x + dx;
            const ny = position.y + dy;
            if (nx < 0 || nx >= canvasWidth || ny < 0 || ny >= canvasHeight) {
              continue;
            }
            const isCenter = dx === 0 && dy === 0;
            const strength = isCenter ? 1 : neighborFalloff;
            simulation.addDensity(nx + 1, ny + 1, r, g, b);
            simulation.addVelocity(
              nx + 1,
              ny + 1,
              forceX * strength,
              forceY * strength,
            );
          }
        }
      }

      prevPosRef.current = position;
    },
    [getCellPosition, canvasWidth, canvasHeight],
  );

  const handlePointerUp = useCallback(() => {
    pointerActiveRef.current = false;
  }, []);

  const toggleSimulation = useCallback(() => {
    setIsRunning((running) => !running);
  }, []);

  const clearSimulation = useCallback(() => {
    simulationRef.current?.clear();
  }, []);

  const updateViscosity = useCallback((value: number) => {
    setViscosity(value);
    paramsRef.current.viscosity = value;
    simulationRef.current?.setViscosity(value);
  }, []);

  const updateDiffusion = useCallback((value: number) => {
    setDiffusion(value);
    paramsRef.current.diffusion = value;
    simulationRef.current?.setDiffusion(value);
  }, []);

  return (
    <div className="animate-fade-in-up flex flex-col items-center space-y-4">
      <canvas
        ref={canvasRef}
        width={canvasWidth * canvasScale}
        height={canvasHeight * canvasScale}
        role="img"
        aria-label="Interactive fluid simulation canvas"
        className={clsx(
          "touch-none rounded-lg border border-gray-300 bg-black transition-transform duration-200 hover:scale-[1.02]",
          isMobile ? "w-full max-w-sm" : "cursor-crosshair",
        )}
        style={{
          maxWidth: isMobile ? "100%" : `${canvasWidth * canvasScale}px`,
          height: "auto",
          aspectRatio: `${canvasWidth} / ${canvasHeight}`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      <div
        className={clsx(
          "animate-fade-in flex flex-wrap items-center justify-center gap-2 [animation-delay:300ms] sm:gap-4",
          isMobile && "text-sm",
        )}
      >
        <button
          onClick={toggleSimulation}
          className={clsx(
            "rounded bg-blue-500 text-white transition hover:scale-105 hover:bg-blue-600 active:scale-95 active:bg-blue-700",
            isMobile ? "px-3 py-2 text-sm" : "px-4 py-2",
          )}
        >
          {isRunning ? "Pause" : "Play"}
        </button>

        <button
          onClick={clearSimulation}
          className={clsx(
            "rounded bg-red-500 text-white transition hover:scale-105 hover:bg-red-600 active:scale-95 active:bg-red-700",
            isMobile ? "px-3 py-2 text-sm" : "px-4 py-2",
          )}
        >
          Clear
        </button>

        <div
          className={clsx(
            "flex items-center space-x-2",
            isMobile && "flex-col space-y-1 space-x-0",
          )}
        >
          <label htmlFor="viscosity-slider" className="text-sm font-medium">
            Viscosity:
          </label>
          <div className="flex items-center space-x-2">
            <input
              id="viscosity-slider"
              type="range"
              min="0.00001"
              max="0.001"
              step="0.00001"
              value={viscosity}
              onChange={(e) => updateViscosity(parseFloat(e.target.value))}
              className={isMobile ? "w-20" : "w-24"}
            />
            <span className="min-w-12 text-xs text-gray-600">
              {viscosity.toFixed(5)}
            </span>
          </div>
        </div>

        <div
          className={clsx(
            "flex items-center space-x-2",
            isMobile && "flex-col space-y-1 space-x-0",
          )}
        >
          <label htmlFor="diffusion-slider" className="text-sm font-medium">
            Diffusion:
          </label>
          <div className="flex items-center space-x-2">
            <input
              id="diffusion-slider"
              type="range"
              min="0.00001"
              max="0.001"
              step="0.00001"
              value={diffusion}
              onChange={(e) => updateDiffusion(parseFloat(e.target.value))}
              className={isMobile ? "w-20" : "w-24"}
            />
            <span className="min-w-12 text-xs text-gray-600">
              {diffusion.toFixed(5)}
            </span>
          </div>
        </div>
      </div>

      <div className="animate-fade-in max-w-md text-center text-sm text-gray-600 [animation-delay:500ms]">
        <p className="mb-2">
          <strong>Desktop:</strong> Click and drag to add fluid and create
          velocity.
        </p>
        <p>
          <strong>Mobile:</strong> Touch and drag for fluid interaction.
        </p>
      </div>
    </div>
  );
};
