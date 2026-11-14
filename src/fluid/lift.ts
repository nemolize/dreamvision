export const gravityInCells = (
  gravity: number,
  widthMetres: number,
  cells: number,
): number => (gravity * cells) / widthMetres;
