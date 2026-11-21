import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HeldPublishPanel } from "./held-publish-panel.tsx";
import type { HeldDecisionState, HeldPublishView } from "../../lib/forms/held-publish.ts";
import { t } from "../../lib/i18n/en.ts";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

function view(overrides: Partial<HeldPublishView> = {}): HeldPublishView {
  return {
    requestId: "apr_1",
    own: false,
    decides: true,
    block: undefined,
    expiresInDays: 7,
    requestedAt: "2026-11-08T10:02:00.000Z",
    ...overrides,
  };
}

function renderPanel(
  views: readonly HeldPublishView[],
  decide: (id: string, decision: "approve" | "reject") => Promise<HeldDecisionState> = () =>
    Promise.resolve({ status: "approved", version: 5 }),
) {
  render(
    <HeldPublishPanel
      views={views}
      summaries={{ apr_1: "Patient intake, 14 questions, 3 steps" }}
      environment="prod"
      decide={decide}
    />,
  );
}

describe("HeldPublishPanel", () => {
  it("shows the requester the request pending, with no Approve", () => {
    renderPanel([view({ own: true, decides: false })]);
    expect(screen.getByText(t("forms.publish.held.waiting"))).toBeTruthy();
    expect(screen.getByText("Expires in 7 days.")).toBeTruthy();
    expect(screen.getByText(t("forms.publish.held"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("forms.publish.requests.approve") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("forms.publish.requests.reject") })).toBeNull();
  });

  it("gives no decision to a viewer without Publish forms in prod", () => {
    renderPanel([view({ decides: false })]);
    expect(
      screen.getByText(t("forms.publish.held.requestNote", { environment: "prod" })),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the approver the bound draft and approves it", async () => {
    const decide = vi.fn<
      (id: string, decision: "approve" | "reject") => Promise<HeldDecisionState>
    >(() => Promise.resolve({ status: "approved", version: 5 }));
    renderPanel([view()], decide);
    expect(screen.getByTestId("qcms-held-publish-summary").textContent).toMatch(
      /^Patient intake, 14 questions, 3 steps, requested /u,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: t("forms.publish.requests.approve") }));
    expect(decide).toHaveBeenCalledWith("apr_1", "approve");
    expect(
      await screen.findByText("v5 frozen by the person who asked, approved by you, live in prod."),
    ).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("announces a refusal and keeps Approve off", async () => {
    renderPanel([view()], () =>
      Promise.resolve({ status: "error", message: t("forms.publish.requests.changed") }),
    );
    const approve = screen.getByRole("button", { name: t("forms.publish.requests.approve") });
    await userEvent.setup().click(approve);
    expect((await screen.findByRole("alert")).textContent).toBe(
      t("forms.publish.requests.changed"),
    );
    expect(
      screen
        .getByRole("button", { name: t("forms.publish.requests.approve") })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("words an unexpected rejection in catalog copy only", async () => {
    renderPanel([view()], () => Promise.reject(new Error("secret upstream text")));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: t("forms.publish.requests.reject") }));
    expect((await screen.findByRole("alert")).textContent).toBe(t("ops.error.unexpected"));
  });

  it("refuses an expired request before Approve is pressed", () => {
    renderPanel([view({ block: "expired", expiresInDays: 0 })]);
    expect(screen.getByRole("alert").textContent).toBe(t("forms.publish.requests.expired"));
    expect(
      screen
        .getByRole("button", { name: t("forms.publish.requests.approve") })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("draws nothing without a pending request", () => {
    const { container } = render(
      <HeldPublishPanel views={[]} summaries={{}} environment="prod" decide={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
