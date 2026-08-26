import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FluidSettings } from "@/fluid/settings";
import { DEFAULT_SETTINGS } from "@/fluid/settings";
import { SettingsPanel } from "@/SettingsPanel";

afterEach(cleanup);

/** Typed so assertions on the reported settings are checked, not `any`. */
const changeSpy = () => vi.fn<(next: FluidSettings) => void>();

/** Narrows away the never-called case, so an assertion on the reported settings
 * fails loudly rather than on a property of `undefined`. */
const lastReported = (spy: ReturnType<typeof changeSpy>): FluidSettings => {
  const call = spy.mock.lastCall;
  if (call === undefined) throw new Error("expected onChange to be called");
  return call[0];
};

const renderPanel = (overrides: Partial<Parameters<typeof SettingsPanel>[0]>) =>
  render(
    <SettingsPanel
      settings={DEFAULT_SETTINGS}
      onChange={vi.fn()}
      onReset={vi.fn()}
      {...overrides}
    />,
  );

describe("SettingsPanel", () => {
  it("shows only the toggle until it is opened", async () => {
    renderPanel({});

    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Open settings" }),
    );

    expect(screen.getAllByRole("slider")).toHaveLength(5);
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
    await userEvent.click(
      screen.getByRole("button", { name: "Open settings" }),
    );

    expect(screen.getByText("0.0035")).toBeTruthy();
    expect(screen.getByText("30")).toBeTruthy();
    expect(screen.getByText("0.20")).toBeTruthy();
  });

  it("reports a moved slider as a whole settings object", async () => {
    const onChange = changeSpy();
    renderPanel({ onChange });
    await userEvent.click(
      screen.getByRole("button", { name: "Open settings" }),
    );

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
    await userEvent.click(
      screen.getByRole("button", { name: "Open settings" }),
    );

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
    await userEvent.click(
      screen.getByRole("button", { name: "Open settings" }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
