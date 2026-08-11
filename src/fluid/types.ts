/** One blob of force and colour injected into the fields. */
export interface Splat {
  /** Normalised position, origin top-left. */
  x: number;
  y: number;
  /** Normalised travel scaled by `SPLAT_FORCE` — a displacement, not a rate;
   * nothing divides it by elapsed time. */
  dx: number;
  dy: number;
  color: readonly [number, number, number];
}

export interface FluidRenderer {
  /** Advance and draw one frame, injecting each splat before the projection. */
  frame: (splats: readonly Splat[]) => void;
  /** Re-fit the simulation grids to a new canvas size. */
  resize: (width: number, height: number) => void;
  destroy: () => void;
}
