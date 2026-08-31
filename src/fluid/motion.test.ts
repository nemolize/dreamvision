import { describe, expect, it, vi } from "vitest";

import { MotionGate, prefersReducedMotion } from "./motion";

const media = (matches: boolean) => vi.fn((_query: string) => ({ matches }));

describe("prefersReducedMotion", () => {
  it("reports the preference the browser answers with", () => {
    expect(prefersReducedMotion({ matchMedia: media(true) })).toBe(true);
    expect(prefersReducedMotion({ matchMedia: media(false) })).toBe(false);
  });

  it("asks for the reduce query, not some other motion query", () => {
    const matchMedia = media(true);
    prefersReducedMotion({ matchMedia });
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("treats a missing matchMedia as no preference", () => {
    expect(prefersReducedMotion({})).toBe(false);
  });
});

describe("MotionGate", () => {
  it("runs and seeds when nothing asks it not to", () => {
    const gate = new MotionGate(false, false);
    expect(gate.open).toBe(true);
    expect(gate.seeds).toBe(true);
  });

  it("opens still under the preference, and stays shut until asked", () => {
    const gate = new MotionGate(true, false);
    expect(gate.seeds).toBe(false);
    expect(gate.open).toBe(false);

    gate.requestMotion();
    expect(gate.open).toBe(true);
  });

  it("closes while hidden and reopens on return", () => {
    const gate = new MotionGate(false, false);
    gate.setHidden(true);
    expect(gate.open).toBe(false);
    gate.setHidden(false);
    expect(gate.open).toBe(true);
  });

  it("stays shut on a tab that starts hidden, without waiting for input", () => {
    const gate = new MotionGate(false, true);
    expect(gate.open).toBe(false);
    // Distinguishes the two reasons: nothing but becoming visible opens this
    // one, so a stray `requestMotion` must not.
    gate.requestMotion();
    expect(gate.open).toBe(false);
    gate.setHidden(false);
    expect(gate.open).toBe(true);
  });

  it("keeps the reduced-motion hold when a tab merely becomes visible", () => {
    const gate = new MotionGate(true, true);
    gate.setHidden(false);
    expect(gate.open).toBe(false);
    gate.requestMotion();
    expect(gate.open).toBe(true);
  });

  it("re-closes on hide even after motion was requested", () => {
    const gate = new MotionGate(true, false);
    gate.requestMotion();
    gate.setHidden(true);
    expect(gate.open).toBe(false);
    gate.setHidden(false);
    expect(gate.open).toBe(true);
  });
});
