export interface Pointer {
  /** Normalised position, origin top-left. */
  x: number;
  y: number;
  /** Normalised travel accumulated since the last `consume`, scaled by
   * `SPLAT_FORCE` — a displacement, not a rate; nothing divides it by elapsed
   * time. */
  dx: number;
  dy: number;
  down: boolean;
  color: readonly [number, number, number];
}

export interface FluidRenderer {
  /** Advance and draw one frame. */
  frame: (pointer: Pointer) => void;
  /** Re-fit the simulation grids to a new canvas size. */
  resize: (width: number, height: number) => void;
  destroy: () => void;
}
