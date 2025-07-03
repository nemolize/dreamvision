"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowSize } from "react-use";
import { FluidSimulation } from "@/lib/fluid-simulation";

interface FluidCanvasProps {
  width?: number;
  height?: number;
  scale?: number;
}

export const FluidCanvas = ({
  width = 120,
  height = 80,
  scale = 6,
}: FluidCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulationRef = useRef<FluidSimulation | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [viscosity, setViscosity] = useState(0.0001);
  const [diffusion, setDiffusion] = useState(0.0001);
  const [mouseDown, setMouseDown] = useState(false);
  const [prevMousePos, setPrevMousePos] = useState({ x: 0, y: 0 });
  const [touchActive, setTouchActive] = useState(false);
  const [color, setColor] = useState({ r: 255, g: 0, b: 0 });

  const { width: windowWidth } = useWindowSize();
  const isMobile = windowWidth < 768;

  const changeColor = useCallback(() => {
    setColor({
      r: Math.random() * 255,
      g: Math.random() * 255,
      b: Math.random() * 255,
    });
  }, []);

  // Responsive dimensions
  const canvasWidth = isMobile ? 80 : width;
  const canvasHeight = isMobile ? 60 : height;
  const canvasScale = isMobile ? 4 : scale;

  const initializeSimulation = useCallback(() => {
    simulationRef.current = new FluidSimulation(canvasWidth, canvasHeight);
    simulationRef.current.setViscosity(viscosity);
    simulationRef.current.setDiffusion(diffusion);
  }, [canvasWidth, canvasHeight, viscosity, diffusion]);

  const drawFluid = useCallback(() => {
    const canvas = canvasRef.current;
    const simulation = simulationRef.current;
    if (!canvas || !simulation) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const imageData = ctx.createImageData(
      canvasWidth * canvasScale,
      canvasHeight * canvasScale,
    );
    const data = imageData.data;
    const densityArrays = simulation.getDensityArrays();

    for (let j = 0; j < canvasHeight; j++) {
      for (let i = 0; i < canvasWidth; i++) {
        const index = i + 1 + (canvasWidth + 2) * (j + 1);
        const r = Math.min(255, Math.max(0, densityArrays.r[index] ?? 0));
        const g = Math.min(255, Math.max(0, densityArrays.g[index] ?? 0));
        const b = Math.min(255, Math.max(0, densityArrays.b[index] ?? 0));

        for (let dy = 0; dy < canvasScale; dy++) {
          for (let dx = 0; dx < canvasScale; dx++) {
            const pixelIndex =
              ((j * canvasScale + dy) * canvasWidth * canvasScale +
                (i * canvasScale + dx)) *
              4;
            data[pixelIndex] = r;
            data[pixelIndex + 1] = g;
            data[pixelIndex + 2] = b;
            data[pixelIndex + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [canvasWidth, canvasHeight, canvasScale]);

  // Animation loop using framer-motion's useAnimate
  useEffect(() => {
    let animationId: number;

    const animate = () => {
      if (isRunning) {
        const simulation = simulationRef.current;
        if (simulation) {
          simulation.step();
          drawFluid();
        }
        animationId = requestAnimationFrame(animate);
      }
    };

    if (isRunning) {
      animationId = requestAnimationFrame(animate);
    }

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [isRunning, drawFluid]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!mouseDown || !simulationRef.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / canvasScale);
      const y = Math.floor((e.clientY - rect.top) / canvasScale);

      const prevX = prevMousePos.x;
      const prevY = prevMousePos.y;

      const amountX = (x - prevX) * 0.5;
      const amountY = (y - prevY) * 0.5;

      if (x >= 0 && x < canvasWidth && y >= 0 && y < canvasHeight) {
        simulationRef.current.addDensity(
          x + 1,
          y + 1,
          color.r,
          color.g,
          color.b,
        );
        simulationRef.current.addVelocity(x + 1, y + 1, amountX, amountY);

        for (let i = -1; i <= 1; i++) {
          for (let j = -1; j <= 1; j++) {
            const nx = x + i;
            const ny = y + j;
            if (nx >= 0 && nx < canvasWidth && ny >= 0 && ny < canvasHeight) {
              simulationRef.current.addDensity(
                nx + 1,
                ny + 1,
                color.r,
                color.g,
                color.b,
              );
              simulationRef.current.addVelocity(
                nx + 1,
                ny + 1,
                amountX * 0.5,
                amountY * 0.5,
              );
            }
          }
        }
      }

      setPrevMousePos({ x, y });
    },
    [
      mouseDown,
      prevMousePos,
      canvasScale,
      canvasWidth,
      canvasHeight,
      color.r,
      color.g,
      color.b,
    ],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      setMouseDown(true);
      changeColor();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / canvasScale);
      const y = Math.floor((e.clientY - rect.top) / canvasScale);
      setPrevMousePos({ x, y });
    },
    [canvasScale, changeColor],
  );

  const handleMouseUp = useCallback(() => {
    setMouseDown(false);
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      setTouchActive(true);
      changeColor();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const touch = e.touches[0];
      if (!touch) return;
      const x = Math.floor((touch.clientX - rect.left) / canvasScale);
      const y = Math.floor((touch.clientY - rect.top) / canvasScale);
      setPrevMousePos({ x, y });
    },
    [canvasScale, changeColor],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (!touchActive || !simulationRef.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const touch = e.touches[0];
      if (!touch) return;
      const x = Math.floor((touch.clientX - rect.left) / canvasScale);
      const y = Math.floor((touch.clientY - rect.top) / canvasScale);

      const prevX = prevMousePos.x;
      const prevY = prevMousePos.y;

      const amountX = (x - prevX) * 0.8;
      const amountY = (y - prevY) * 0.8;

      if (x >= 0 && x < canvasWidth && y >= 0 && y < canvasHeight) {
        simulationRef.current.addDensity(
          x + 1,
          y + 1,
          color.r,
          color.g,
          color.b,
        );
        simulationRef.current.addVelocity(x + 1, y + 1, amountX, amountY);

        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < canvasWidth && ny >= 0 && ny < canvasHeight) {
              simulationRef.current.addDensity(
                nx + 1,
                ny + 1,
                color.r,
                color.g,
                color.b,
              );
              simulationRef.current.addVelocity(
                nx + 1,
                ny + 1,
                amountX * 0.7,
                amountY * 0.7,
              );
            }
          }
        }
      }

      setPrevMousePos({ x, y });
    },
    [
      touchActive,
      prevMousePos,
      canvasScale,
      canvasWidth,
      canvasHeight,
      color.r,
      color.g,
      color.b,
    ],
  );

  const handleTouchEnd = useCallback(() => {
    setTouchActive(false);
  }, []);

  const toggleSimulation = useCallback(() => {
    setIsRunning(!isRunning);
  }, [isRunning]);

  const clearSimulation = useCallback(() => {
    simulationRef.current?.clear();
  }, []);

  const updateViscosity = useCallback((value: number) => {
    setViscosity(value);
    simulationRef.current?.setViscosity(value);
  }, []);

  const updateDiffusion = useCallback((value: number) => {
    setDiffusion(value);
    simulationRef.current?.setDiffusion(value);
  }, []);

  useEffect(() => {
    initializeSimulation();
  }, [initializeSimulation]);

  return (
    <motion.div
      className="flex flex-col items-center space-y-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <motion.canvas
        ref={canvasRef}
        width={canvasWidth * canvasScale}
        height={canvasHeight * canvasScale}
        className={clsx(
          "touch-none rounded-lg border border-gray-300 bg-black",
          isMobile ? "w-full max-w-sm" : "cursor-crosshair",
        )}
        style={{
          maxWidth: isMobile ? "100%" : `${canvasWidth * canvasScale}px`,
          height: "auto",
          aspectRatio: `${canvasWidth} / ${canvasHeight}`,
        }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        whileHover={{ scale: 1.02 }}
        transition={{ type: "spring", stiffness: 300 }}
      />

      <motion.div
        className={clsx(
          "flex flex-wrap items-center justify-center gap-2 sm:gap-4",
          isMobile && "text-sm",
        )}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <motion.button
          onClick={toggleSimulation}
          className={clsx(
            "rounded bg-blue-500 text-white transition-colors hover:bg-blue-600 active:bg-blue-700",
            isMobile ? "px-3 py-2 text-sm" : "px-4 py-2",
          )}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {isRunning ? "Pause" : "Play"}
        </motion.button>

        <motion.button
          onClick={clearSimulation}
          className={clsx(
            "rounded bg-red-500 text-white transition-colors hover:bg-red-600 active:bg-red-700",
            isMobile ? "px-3 py-2 text-sm" : "px-4 py-2",
          )}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          Clear
        </motion.button>

        <div
          className={clsx(
            "flex items-center space-x-2",
            isMobile && "flex-col space-x-0 space-y-1",
          )}
        >
          <label htmlFor="viscosity-slider" className="font-medium text-sm">
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
            <span className="min-w-12 text-gray-600 text-xs">
              {viscosity.toFixed(5)}
            </span>
          </div>
        </div>

        <div
          className={clsx(
            "flex items-center space-x-2",
            isMobile && "flex-col space-x-0 space-y-1",
          )}
        >
          <label htmlFor="diffusion-slider" className="font-medium text-sm">
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
            <span className="min-w-12 text-gray-600 text-xs">
              {diffusion.toFixed(5)}
            </span>
          </div>
        </div>
      </motion.div>

      <motion.div
        className="max-w-md text-center text-gray-600 text-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.5 }}
      >
        <p className="mb-2">
          <strong>Desktop:</strong> Click and drag to add fluid and create
          velocity.
        </p>
        <p>
          <strong>Mobile:</strong> Touch and drag for fluid interaction.
        </p>
      </motion.div>
    </motion.div>
  );
};
