export interface Pointer {
  /** Normalised position, origin top-left. */
  x: number;
  y: number;
  /** Normalised travel accumulated since the last frame, scaled by
   * `SPLAT_FORCE`. Not a rate: it is never divided by elapsed time, so a given
   * drag deposits the same impulse however long the frame took. */
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
