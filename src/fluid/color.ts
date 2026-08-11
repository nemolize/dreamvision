/** Dye is additive and unbounded, so a splat starts dim and brightens as the
 * pointer lingers. */
export const DYE_INTENSITY = 0.25;

/** A fully-saturated colour at hue `h` (0..1) — the HSV-to-RGB conversion with
 * s = v = 1, which keeps successive splats vivid rather than averaging to grey. */
export const hueToRgb = (h: number): [number, number, number] => {
  const channel = (offset: number): number => {
    const position = (h * 6 + offset) % 6;
    return Math.max(0, Math.min(1, Math.min(position, 4 - position, 1)));
  };
  return [
    channel(2) * DYE_INTENSITY,
    channel(0) * DYE_INTENSITY,
    channel(4) * DYE_INTENSITY,
  ];
};

export const randomColor = (): [number, number, number] =>
  hueToRgb(Math.random());
