import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { heldRequests } from "@/lib/membership/approval-wording";
import type { ApprovalRequest, MembershipActionState } from "@/lib/membership/types";

import { WorkspaceRequestsPanel } from "./workspace-requests-panel";

const DONE: MembershipActionState = { status: "done", message: "ok" };
const NOW = new Date("2026-11-20T12:00:00.000Z");
const PEOPLE = new Map([
  ["usr_1", "grace@qcms.test"],
  ["usr_2", "sam@qcms.test"],
]);

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    requestId: "apr_1",
    kind: "second-approval-off",
    target: "ws_1",
    payload: {},
    requestedBy: "usr_1",
    requestedAt: "2026-11-20T12:00:00.000Z",
    expiresAt: "2026-11-27T12:00:00.000Z",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
}

function renderPanel(
  requests: readonly ApprovalRequest[],
  viewerId: string,
  decide = vi.fn(() => Promise.resolve(DONE)),
) {
  render(
    <WorkspaceRequestsPanel
      workspaceId="ws_1"
      requests={heldRequests(requests, NOW)}
      message={undefined}
      viewerId={viewerId}
      people={PEOPLE}
      decide={decide}
    />,
  );
  return decide;
}

describe("the Requests row", () => {
  it("shows a pending request with its window, and offers no decision to the person who asked", () => {
    renderPanel([request()], "usr_1");
    expect(screen.getByText("grace@qcms.test asked to turn Second approval off.")).toBeTruthy();
    expect(screen.getByText("Needs an Approver")).toBeTruthy();
    expect(screen.getByText("Expires in 7 days.")).toBeTruthy();
    expect(screen.getByText("You asked for this, so somebody else decides it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Approve/u })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Reject/u })).toBeNull();
  });

  it("offers Approve and Reject to another administrator, naming the request", async () => {
    const decide = renderPanel([request()], "usr_2");
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", {
        name: "Approve: grace@qcms.test asked to turn Second approval off.",
      }),
    );
    expect(decide).toHaveBeenCalledWith("ws_1", "apr_1", "approve");
    await user.click(
      screen.getByRole("button", {
        name: "Reject: grace@qcms.test asked to turn Second approval off.",
      }),
    );
  });

  it("reads a lapsed request as an ending by the approver who tried, not a rejection", () => {
    renderPanel([request({ status: "lapsed", decidedBy: "usr_2" })], "usr_1");
    const ended = screen.getByText(/Ended undecided by sam@qcms.test/u);
    expect(ended.textContent).toContain("nothing was applied");
    expect(screen.queryByText(/Rejected by/u)).toBeNull();
    expect(screen.queryByText("Needs an Approver")).toBeNull();
  });

  it("counts what is waiting and says so when nothing is", () => {
    renderPanel([request(), request({ requestId: "apr_2", kind: "move-form" })], "usr_2");
    expect(screen.getByText("2 pending")).toBeTruthy();
    expect(
      screen.getByText("grace@qcms.test asked to move a form out of this workspace."),
    ).toBeTruthy();
  });

  it("says nothing is waiting over an empty list", () => {
    renderPanel([], "usr_2");
    expect(screen.getByText("Nothing is waiting for an Approver.")).toBeTruthy();
    expect(screen.queryByText(/pending$/u)).toBeNull();
  });

  it("reports a refused read as a refusal rather than an empty row", () => {
    render(
      <WorkspaceRequestsPanel
        workspaceId="ws_1"
        requests={undefined}
        message="403"
        viewerId="usr_2"
        people={PEOPLE}
        decide={vi.fn(() => Promise.resolve(DONE))}
      />,
    );
    expect(screen.getByText(/could not be read: 403/u)).toBeTruthy();
    expect(screen.queryByText("Nothing is waiting for an Approver.")).toBeNull();
  });
});
