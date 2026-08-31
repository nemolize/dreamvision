import { describe, expect, it, vi } from "vitest";

import { creditedElapsed, MotionGate, reducedMotionQuery } from "./motion";

const media = (matches: boolean) => vi.fn((_query: string) => ({ matches }));

describe("reducedMotionQuery", () => {
  it("hands back the query the browser answers with", () => {
    expect(reducedMotionQuery({ matchMedia: media(true) })?.matches).toBe(true);
    expect(reducedMotionQuery({ matchMedia: media(false) })?.matches).toBe(
      false,
    );
  });

  it("asks for the reduce query, not some other motion query", () => {
    const matchMedia = media(true);
    reducedMotionQuery({ matchMedia });
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("reports a missing matchMedia as no query to subscribe to", () => {
    expect(reducedMotionQuery({})).toBeNull();
  });
});

describe("creditedElapsed", () => {
  it("passes an ordinary frame through untouched", () => {
    expect(creditedElapsed(1 / 60)).toBeCloseTo(1 / 60, 6);
    expect(creditedElapsed(1 / 15)).toBeCloseTo(1 / 15, 6);
  });

  it("drops a gap far longer than a frame instead of banking it", () => {
    // The case the hidden-tab path produces: visibilitychange reopens the gate
    // before the first resumed frame, so this gap arrives with the gate open.
    expect(creditedElapsed(60)).toBe(0);
    expect(creditedElapsed(2)).toBe(0);
  });

  it("credits time strictly below the cap and drops it strictly above", () => {
    expect(creditedElapsed(0.25)).toBe(0.25);
    expect(creditedElapsed(0.2501)).toBe(0);
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

  it("re-arms the hold when the preference is switched on mid-session", () => {
    const gate = new MotionGate(false, false);
    expect(gate.open).toBe(true);

    gate.setReducedMotion(true);
    expect(gate.open).toBe(false);
    expect(gate.seeds).toBe(false);

    gate.requestMotion();
    expect(gate.open).toBe(true);
  });

  it("releases a hold that was already lifted when the preference goes away", () => {
    const gate = new MotionGate(true, false);
    expect(gate.open).toBe(false);

    gate.setReducedMotion(false);
    expect(gate.open).toBe(true);
    expect(gate.seeds).toBe(true);
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
