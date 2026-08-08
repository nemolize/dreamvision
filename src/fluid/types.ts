export interface Pointer {
  /** Normalised position, origin top-left. */
  x: number;
  y: number;
  /** Motion since the previous frame, in normalised units per second. */
  dx: number;
  dy: number;
  down: boolean;
  color: readonly [number, number, number];
}

export interface FluidRenderer {
  /** Advance and draw one frame. */
  frame: (pointer: Pointer) => void;
  /** Re-fit the grids and swap-chain to a new canvas size. */
  resize: (width: number, height: number) => void;
  destroy: () => void;
}
