export interface SettingDescriptor<Key extends string> {
  key: Key;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Decimals shown beside the slider; the step's precision, not the value's. */
  precision: number;
  /** Spaces the track by ratio; needs `min > 0`. `step` and `precision` go
   * unused then: the readout keeps three significant figures. */
  track?: "log";
}

export const LOG_TRACK_STEPS = 1000;

type Range = Pick<SettingDescriptor<string>, "min" | "max">;

export const toTrackPosition = ({ min, max }: Range, value: number): number => {
  const share = Math.log(value / min) / Math.log(max / min);
  return Math.round(Math.min(1, Math.max(0, share)) * LOG_TRACK_STEPS);
};

export const fromTrackPosition = (
  { min, max }: Range,
  position: number,
): number => {
  if (position <= 0) return min;
  if (position >= LOG_TRACK_STEPS) return max;
  return min * (max / min) ** (position / LOG_TRACK_STEPS);
};

export const formatSetting = (
  { precision, track }: Pick<SettingDescriptor<string>, "precision" | "track">,
  value: number,
): string =>
  track === "log" ? value.toPrecision(3) : value.toFixed(precision);

export interface DescriptorSet<Key extends string> {
  clamp: (key: Key, value: number) => number;
  normalise: (input: unknown) => Record<Key, number>;
}

export const describeSettings = <Key extends string>(
  descriptors: readonly SettingDescriptor<Key>[],
  defaults: Readonly<Record<Key, number>>,
): DescriptorSet<Key> => {
  const byKey = new Map(
    descriptors.map((descriptor) => [descriptor.key, descriptor]),
  );

  /** A stored setting outlives the range that produced it, so a value read back
   * is untrusted input rather than one this build wrote. */
  const clamp = (key: Key, value: number): number => {
    const descriptor = byKey.get(key);
    if (descriptor === undefined || !Number.isFinite(value)) {
      return defaults[key];
    }
    const bounded = Math.min(descriptor.max, Math.max(descriptor.min, value));
    // Integer-step settings index a loop, a count or a grid edge, so a consumer
    // given a fractional one would re-guard what the descriptor already declares.
    return Number.isInteger(descriptor.step) ? Math.round(bounded) : bounded;
  };

  /** Falls back per key rather than wholesale, so a blob predating a key this
   * build added still yields every slider a value. */
  const normalise = (input: unknown): Record<Key, number> => {
    const result: Record<Key, number> = { ...defaults };
    if (typeof input !== "object" || input === null) return result;
    const entries = new Map<string, unknown>(Object.entries(input));
    for (const { key } of descriptors) {
      const value = entries.get(key);
      if (typeof value === "number") result[key] = clamp(key, value);
    }
    return result;
  };

  return { clamp, normalise };
};
