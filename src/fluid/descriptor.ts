export interface SettingDescriptor<Key extends string> {
  key: Key;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Decimals shown beside the slider; the step's precision, not the value's. */
  precision: number;
}

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
