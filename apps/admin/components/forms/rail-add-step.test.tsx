import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestAddStep } from "@/lib/forms/add-step-request";
import { t } from "@/lib/i18n/en";

/**
 * Add step, in the rail's Actions part, and the one thing about it that is not local state
 * (§7.0 ruling 2.5, issue #1116).
 *
 * The control is asked for from two places and §7.0 moved them apart: the control itself sits
 * at the foot of the rail, and the form row's own menu sits at the top of the step list, so
 * the way in is still reachable once a long list has pushed the control out of the rail's
 * scroll. Those are two components now, under a frame that is a server component, so what
 * crosses between them is `lib/forms/add-step-request.ts` - and a module store outlives a
 * route, which is exactly the defect `resetSettingsPanel` exists for one module over.
 *
 * So the two assertions here are the two halves of that seam:
 *
 * - a request from the menu opens the one dialog, which is what the store is for;
 * - a control that mounts AFTER a request opens nothing, which is what the store being
 *   cleared on unmount buys. Without it the count survived the route - press Add step on the
 *   builder, walk to Preview, come back - and the fresh mount's `seen` ref had never seen the
 *   number, so the dialog opened with nobody having asked.
 *
 * ## Why the builder bridge is stubbed and the kit is not
 *
 * `useBuilderRail` is how this control knows whether there is a draft in the browser to add a
 * step to; off the builder it renders an anchor to the builder instead. The stub is what puts
 * it on the builder's branch, and `add` is a spy because committing a step is the builder's
 * business and is asserted where the builder is. The dialog itself is the real vendored one,
 * because "one dialog, opened from two places" is a claim about that element.
 */

vi.mock("@/lib/forms/builder-bridge", () => ({
  useBuilderRail: () => ({ add: vi.fn() }),
}));

const { RailAddStep } = await import("./rail-add-step.tsx");

const BUILDER_HREF = "/forms/frm_quote";

afterEach(() => {
  // The store is a module, so a request left behind here would reach the next test. The
  // component clears it as it unmounts and `cleanup` unmounts it; this is the belt, so that a
  // regression in the reset fails its own test below rather than the next one.
  requestAddStep();
});

describe("the rail's Add step control", () => {
  it("opens its one dialog when the form row's menu asks for a step", async () => {
    render(<RailAddStep builderHref={BUILDER_HREF} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("forms.steps.add") }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    // One dialog, whichever way in was used: two would be two drafts of one step title, and
    // which one you had typed into would depend on the control you reached for.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("opens nothing on a remount, because the request does not outlive the route", async () => {
    const first = render(<RailAddStep builderHref={BUILDER_HREF} />);
    requestAddStep();
    // The request lands on the mounted control: this is the store doing its job, and it is
    // what makes the second half a real claim rather than an absence proving nothing.
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
