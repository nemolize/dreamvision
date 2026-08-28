import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GpuNotice } from "@/GpuNotice";

afterEach(cleanup);

describe("GpuNotice", () => {
  it("announces the failure, so a frozen canvas is not the only signal", () => {
    render(<GpuNotice message="The GPU device was lost." />);

    expect(screen.getByRole("alert").textContent).toContain(
      "The GPU device was lost.",
    );
  });

  it("offers no reset when the caller judged the resolution innocent", () => {
    render(<GpuNotice message="The GPU device was lost." />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the reset when the caller judged the resolution suspect", async () => {
    const onResetResolution = vi.fn();
    render(
      <GpuNotice
        message="The GPU device was lost."
        onResetResolution={onResetResolution}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Reset resolution and reload" }),
    );

    // The stored resolution is what a reload would rebuild at, so without this
    // the notice is a dead end rather than a way out.
    expect(onResetResolution).toHaveBeenCalledTimes(1);
  });
});
