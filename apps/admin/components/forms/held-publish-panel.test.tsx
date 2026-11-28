import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HeldPublishPanel } from "./held-publish-panel.tsx";
import type { HeldDecisionState, HeldPublishView } from "../../lib/forms/held-publish.ts";
import { environmentLabel } from "../../lib/environment.ts";
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
    Promise.resolve({ status: "approved", version: 5, requester: null, approver: null }),
) {
  render(
    <HeldPublishPanel
      views={views}
      summaries={{ apr_1: "Patient intake, 14 questions, 6 changes since v4" }}
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
      screen.getByText(
        t("forms.publish.held.requestNote", { environment: environmentLabel("prod") }),
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the approver the bound draft and approves it", async () => {
    const decide = vi.fn<
      (id: string, decision: "approve" | "reject") => Promise<HeldDecisionState>
    >(() =>
      Promise.resolve({
        status: "approved",
        version: 5,
        requester: "Grace Mensah",
        approver: "Luis Ortega",
      }),
    );
    renderPanel([view()], decide);
    expect(screen.getByTestId("qcms-held-publish-summary").textContent).toMatch(
      /^Patient intake, 14 questions, 6 changes since v4, requested /u,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: t("forms.publish.requests.approve") }));
    expect(decide).toHaveBeenCalledWith("apr_1", "approve");
    expect(
      await screen.findByText(
        "v5 frozen by Grace Mensah, approved by Luis Ortega, live in Production.",
      ),
    ).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("announces a refusal and offers no second decision", async () => {
    renderPanel([view()], () =>
      Promise.resolve({ status: "error", message: t("forms.publish.requests.changed") }),
    );
    const approve = screen.getByRole("button", { name: t("forms.publish.requests.approve") });
    await userEvent.setup().click(approve);
    expect((await screen.findByRole("alert")).textContent).toBe(
      t("forms.publish.requests.changed"),
    );
    expect(screen.queryByRole("button", { name: t("forms.publish.requests.approve") })).toBeNull();
  });

  it("keeps the outcome once the refresh takes the decided request away", async () => {
    const decide = () =>
      Promise.resolve<HeldDecisionState>({
        status: "approved",
        version: 5,
        requester: "Grace Mensah",
        approver: "Luis Ortega",
      });
    const { rerender } = render(
      <HeldPublishPanel views={[view()]} summaries={{}} environment="prod" decide={decide} />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: t("forms.publish.requests.approve") }));
    const sentence = "v5 frozen by Grace Mensah, approved by Luis Ortega, live in Production.";
    expect(await screen.findByText(sentence)).toBeTruthy();

    rerender(<HeldPublishPanel views={[]} summaries={{}} environment="prod" decide={decide} />);
    expect(screen.getByText(sentence)).toBeTruthy();
    expect(screen.queryByTestId("qcms-held-publish")).toBeNull();
  });

  it("keeps a lapse refusal once the lapsed request leaves the list", async () => {
    const decide = () =>
      Promise.resolve<HeldDecisionState>({
        status: "error",
        message: t("forms.publish.requests.changed"),
      });
    const { rerender } = render(
      <HeldPublishPanel views={[view()]} summaries={{}} environment="prod" decide={decide} />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: t("forms.publish.requests.approve") }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    rerender(<HeldPublishPanel views={[]} summaries={{}} environment="prod" decide={decide} />);
    expect(screen.getByRole("alert").textContent).toBe(t("forms.publish.requests.changed"));
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
