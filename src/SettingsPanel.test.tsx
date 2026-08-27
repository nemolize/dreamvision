import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResolutionSettings } from "@/fluid/resolution";
import { DEFAULT_RESOLUTION } from "@/fluid/resolution";
import type { FluidSettings } from "@/fluid/settings";
import { DEFAULT_SETTINGS } from "@/fluid/settings";
import { SettingsPanel } from "@/SettingsPanel";

afterEach(cleanup);

/** Typed so assertions on the reported settings are checked, not `any`. */
const changeSpy = () => vi.fn<(next: FluidSettings) => void>();
const resolutionSpy = () => vi.fn<(next: ResolutionSettings) => void>();

/** Narrows away the never-called case, so an assertion on the reported settings
 * fails loudly rather than on a property of `undefined`. */
const lastReported = <Value,>(spy: {
  mock: { lastCall: [Value] | undefined };
}): Value => {
  const call = spy.mock.lastCall;
  if (call === undefined) throw new Error("expected the handler to be called");
  return call[0];
};

const renderPanel = (overrides: Partial<Parameters<typeof SettingsPanel>[0]>) =>
  render(
    <SettingsPanel
      settings={DEFAULT_SETTINGS}
      resolution={DEFAULT_RESOLUTION}
      onChange={vi.fn()}
      onResolutionChange={vi.fn()}
      onReset={vi.fn()}
      {...overrides}
    />,
  );

const open = async (): Promise<void> => {
  await userEvent.click(screen.getByRole("button", { name: "Open settings" }));
};

describe("SettingsPanel", () => {
  it("shows only the toggle until it is opened", async () => {
    renderPanel({});

    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();

    await open();

    expect(screen.getAllByRole("slider")).toHaveLength(7);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  });

  it("closes again, and stops pointing at the panel it no longer renders", async () => {
    renderPanel({});
    const toggle = screen.getByRole("button", { name: "Open settings" });

    await userEvent.click(toggle);
    const opened = screen.getByRole("button", { name: "Close settings" });
    expect(opened.getAttribute("aria-controls")).not.toBeNull();

    await userEvent.click(opened);
    const closed = screen.getByRole("button", { name: "Open settings" });
    expect(screen.queryByRole("slider")).toBeNull();
    // The panel is unmounted while collapsed, so a retained id would dangle.
    expect(closed.getAttribute("aria-controls")).toBeNull();
  });

  it("renders each value at its descriptor's precision", async () => {
    renderPanel({});
    await open();

    expect(screen.getByText("0.0035")).toBeTruthy();
    expect(screen.getByText("30")).toBeTruthy();
    expect(screen.getByText("0.20")).toBeTruthy();
  });

  it("reports a moved slider as a whole settings object", async () => {
    const onChange = changeSpy();
    renderPanel({ onChange });
    await open();

    const force = screen.getByRole("slider", { name: "Splat force" });
    fireEvent.change(force, { target: { value: "31" } });

    const reported = lastReported(onChange);
    // The whole object, not just the moved key: the parent replaces its state
    // wholesale, so a partial would drop every other setting.
    expect(Object.keys(reported).sort()).toEqual(
      Object.keys(DEFAULT_SETTINGS).sort(),
    );
    expect(reported.splatForce).toBe(DEFAULT_SETTINGS.splatForce + 1);
    expect(reported.dyeDissipation).toBe(DEFAULT_SETTINGS.dyeDissipation);
  });

  it("clamps a value the input reports outside the descriptor's range", async () => {
    const onChange = changeSpy();
    renderPanel({ onChange });
    await open();

    const force = screen.getByRole("slider", { name: "Splat force" });
    force.setAttribute("max", "1000");
    fireEvent.change(force, { target: { value: "900" } });

    // The descriptor's range, not the input's: a stale max in the DOM must not
    // widen what reaches the solver.
    expect(lastReported(onChange).splatForce).toBe(100);
  });

  it("hands the reset decision to its parent", async () => {
    const onReset = vi.fn();
    const onChange = changeSpy();
    renderPanel({ onReset, onChange });
    await open();

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  describe("resolution sliders", () => {
    it("shows a dragged value without reporting it, since each report rebuilds every texture", async () => {
      const onResolutionChange = resolutionSpy();
      renderPanel({ onResolutionChange });
      await open();

      const sim = screen.getByRole("slider", { name: "Sim grid" });
      fireEvent.change(sim, { target: { value: "192" } });
      fireEvent.change(sim, { target: { value: "224" } });

      expect(onResolutionChange).not.toHaveBeenCalled();
      expect(screen.getByText("224")).toBeTruthy();
    });

    it("reports the value the drag rested on, once", async () => {
      const onResolutionChange = resolutionSpy();
      renderPanel({ onResolutionChange });
      await open();

      const sim = screen.getByRole("slider", { name: "Sim grid" });
      fireEvent.change(sim, { target: { value: "192" } });
      fireEvent.change(sim, { target: { value: "224" } });
      fireEvent.pointerUp(sim);

      expect(onResolutionChange).toHaveBeenCalledTimes(1);
      expect(lastReported(onResolutionChange)).toEqual({
        ...DEFAULT_RESOLUTION,
        simResolution: 224,
      });
    });

    it("commits a keyboard adjustment on key release", async () => {
      const onResolutionChange = resolutionSpy();
      renderPanel({ onResolutionChange });
      await open();

      const dye = screen.getByRole("slider", { name: "Dye grid" });
      fireEvent.change(dye, { target: { value: "1152" } });
      fireEvent.keyUp(dye, { key: "ArrowRight" });

      expect(lastReported(onResolutionChange).dyeResolution).toBe(1152);
    });

    it("stays quiet when a release follows no movement", async () => {
      const onResolutionChange = resolutionSpy();
      renderPanel({ onResolutionChange });
      await open();

      fireEvent.pointerUp(screen.getByRole("slider", { name: "Sim grid" }));

      expect(onResolutionChange).not.toHaveBeenCalled();
    });

    it("clamps a value the input reports outside the descriptor's range", async () => {
      const onResolutionChange = resolutionSpy();
      renderPanel({ onResolutionChange });
      await open();

      const sim = screen.getByRole("slider", { name: "Sim grid" });
      sim.setAttribute("max", "8192");
      fireEvent.change(sim, { target: { value: "8192" } });
      fireEvent.pointerUp(sim);

      expect(lastReported(onResolutionChange).simResolution).toBe(512);
    });

    it("drops an uncommitted drag when the panel is reset", async () => {
      const onResolutionChange = resolutionSpy();
      renderPanel({ onResolutionChange });
      await open();

      const sim = screen.getByRole("slider", { name: "Sim grid" });
      fireEvent.change(sim, { target: { value: "192" } });
      await userEvent.click(screen.getByRole("button", { name: "Reset" }));

      // The parent's reset is the authority; a pending value surviving it would
      // reach the renderer on the next release.
      expect(onResolutionChange).not.toHaveBeenCalled();
      expect(sim).toHaveProperty(
        "value",
        String(DEFAULT_RESOLUTION.simResolution),
      );
    });
  });
});
