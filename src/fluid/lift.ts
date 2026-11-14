export const gravityInCells = (
  gravity: number,
  longSideMetres: number,
  cells: number,
): number => (gravity * cells) / longSideMetres;
