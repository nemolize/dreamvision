/** Gravity in cells per second squared, on a grid `cells` wide that spans a
 * canvas `scale` metres across. */
export const gravityInCells = (
  gravity: number,
  scale: number,
  cells: number,
): number => (gravity * cells) / scale;
