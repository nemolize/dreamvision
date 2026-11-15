export const gravityInCells = (
  gravity: number,
  longSideMetres: number,
  cells: number,
): number => (gravity * cells) / longSideMetres;

export const shakeInCells = (
  shake: readonly [number, number],
  strength: number,
  longSideMetres: number,
  cells: number,
): [number, number] => [
  gravityInCells(shake[0] * strength, longSideMetres, cells),
  gravityInCells(shake[1] * strength, longSideMetres, cells),
];
