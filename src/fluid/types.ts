import type { FluidSettings } from "./settings";

/** One blob of force and colour injected into the fields. */
export interface Splat {
  /** Normalised position, origin top-left. */
  x: number;
  y: number;
  /** A displacement, not a rate; nothing divides it by elapsed time. */
  dx: number;
  dy: number;
  color: readonly [number, number, number];
}

export interface FluidRenderer {
  /** Advance and draw one frame, injecting each splat before the projection. */
  frame: (splats: readonly Splat[]) => void;
  applySettings: (settings: FluidSettings) => void;
  resize: (width: number, height: number) => void;
  destroy: () => void;
}
