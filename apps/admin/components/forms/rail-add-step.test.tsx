import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestAddStep } from "@/lib/forms/add-step-request";
import { t } from "@/lib/i18n/en";

vi.mock("@/lib/forms/builder-bridge", () => ({
  useBuilderRail: () => ({ add: vi.fn() }),
}));

const { RailAddStep } = await import("./rail-add-step.tsx");

const BUILDER_HREF = "/forms/frm_quote";

afterEach(() => {
  requestAddStep();
});

describe("the rail's Add step control", () => {
  it("opens its one dialog when the form row's menu asks for a step", async () => {
    render(<RailAddStep builderHref={BUILDER_HREF} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("forms.steps.add") }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("opens nothing on a remount, because the request does not outlive the route", async () => {
    const first = render(<RailAddStep builderHref={BUILDER_HREF} />);
    requestAddStep();
    expect(await screen.findByRole("dialog")).toBeTruthy();
    first.unmount();

    render(<RailAddStep builderHref={BUILDER_HREF} />);
    expect(
      screen.queryByRole("dialog"),
      "a fresh control must not reopen a dialog the reader has left",
    ).toBeNull();
    expect(screen.getByRole("button", { name: t("forms.steps.add") })).toBeTruthy();
  });
});
