import type { Direction } from "./gravity";
import type { ResolutionSettings } from "./resolution";
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
  /** Advance by `dt` seconds and draw one frame, injecting each splat before
   * the projection. */
  frame: (splats: readonly Splat[], dt: number, up: Direction) => void;
  applySettings: (settings: FluidSettings) => void;
  setResolution: (resolution: ResolutionSettings) => void;
  resize: (width: number, height: number) => void;
  /** A listener receives the GPU milliseconds of the frames sampled, not every
   * frame; `null` stops it. Nothing is reported without `timestamp-query`. */
  measureGpu: (listener: ((milliseconds: number) => void) | null) => void;
  destroy: () => void;
}
