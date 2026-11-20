import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n/en";
import type { Account } from "@/lib/site/accounts";
import { demoteControl, promoteControl, type RoleActState } from "@/lib/site/administrators";
import { decisionControl, type SiteApprovalRequest } from "@/lib/site/approvals";

import { ApprovalRequestsPanel, type ApprovalRow } from "./approval-requests-panel";
import { SiteAdministratorsPanel } from "./site-administrators-panel";

function isOff(button: HTMLElement): boolean {
  return button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true";
}

const NOW = new Date("2026-11-12T09:00:00.000Z");

function request(overrides: Partial<SiteApprovalRequest>): SiteApprovalRequest {
  return {
    requestId: "apr_1",
    scope: "site",
    workspaceId: null,
    kind: "promote",
    target: "usr_target",
    payload: {},
    requestedBy: "usr_asker",
    requestedAt: "2026-11-10T09:00:00.000Z",
    expiresAt: "2026-11-17T09:00:00.000Z",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
}

function row(value: SiteApprovalRequest, viewer: string): ApprovalRow {
  return {
    request: value,
    asked: `Sam Okafor asked about ${value.requestId}.`,
    workspace: value.workspaceId === null ? undefined : "Clinical",
    decidedBy: "Grace Mensah",
    expiresInDays: 5,
    control: decisionControl(value, viewer, NOW),
  };
}

const done = (): Promise<RoleActState> => Promise.resolve({ status: "done", message: "Done." });

describe("the Approval requests list", () => {
  it("shows the requester no Approve on their own request, with the reason", () => {
    render(
      <ApprovalRequestsPanel
        rows={[
          row(request({}), "usr_asker"),
          row(
            request({ requestId: "apr_2", scope: "workspace", workspaceId: "org_1" }),
            "usr_asker",
          ),
        ]}
        decideSite={done}
        decideWorkspace={done}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Approve/u })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Reject/u })).toBeNull();
    expect(screen.getAllByText(t("site.requests.blocked.own"))).toHaveLength(2);
  });

  it("shows the target of a site request no Approve either", () => {
    render(
      <ApprovalRequestsPanel
        rows={[row(request({}), "usr_target")]}
        decideSite={done}
        decideWorkspace={done}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Approve/u })).toBeNull();
    expect(screen.getByText(t("site.requests.blocked.target"))).toBeTruthy();
  });

  it("asks a step-up before approving a site request, and sends nothing until it is given", async () => {
    const decideSite = vi.fn(done);
    const user = userEvent.setup();
    render(
      <ApprovalRequestsPanel
        rows={[row(request({}), "usr_other")]}
        decideSite={decideSite}
        decideWorkspace={done}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Approve/u }));
    const dialog = screen.getByRole("dialog");
    expect(decideSite).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole("button", { name: t("membership.requests.approve") });
    expect(isOff(confirm)).toBe(true);
    await user.type(within(dialog).getByLabelText(/^Password/u), "a-password");
    await user.type(within(dialog).getByLabelText(/^Second factor code/u), "123456");
    await user.click(confirm);
    await waitFor(() => {
      expect(decideSite).toHaveBeenCalledWith("apr_1", "approve", {
        password: "a-password",
        code: "123456",
      });
    });
  });

  it("decides a workspace request at once, through its workspace", async () => {
    const decideWorkspace = vi.fn(done);
    const user = userEvent.setup();
    render(
      <ApprovalRequestsPanel
        rows={[
          row(
            request({ scope: "workspace", workspaceId: "org_1", kind: "self-grant" }),
            "usr_other",
          ),
        ]}
        decideSite={done}
        decideWorkspace={decideWorkspace}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Reject/u }));
    await waitFor(() => {
      expect(decideWorkspace).toHaveBeenCalledWith("org_1", "apr_1", "reject");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says who decided an ended request and offers nothing to press", () => {
    render(
      <ApprovalRequestsPanel
        rows={[row(request({ status: "rejected", decidedBy: "usr_grace" }), "usr_other")]}
        decideSite={done}
        decideWorkspace={done}
      />,
    );
    expect(screen.getByText("Rejected by Grace Mensah.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

const ME: Account = {
  userId: "usr_me",
  email: "me@example.test",
  name: "Sam Okafor",
  siteAdministrator: true,
  status: "active",
};

const JORDAN: Account = {
  userId: "usr_jordan",
  email: "jordan@example.test",
  name: "Jordan Lee",
  siteAdministrator: false,
  status: "unclaimed",
};

const PRIYA: Account = { ...JORDAN, userId: "usr_priya", name: "Priya Shah", status: "active" };

describe("the Site administrators screen", () => {
  const viewer = { userId: "usr_me", activeSiteAdministrators: 1 };

  it("disables Demote for the last active Site administrator and Promote for an unclaimed account", () => {
    render(
      <SiteAdministratorsPanel
        administrators={[{ account: ME, control: demoteControl(ME, viewer) }]}
        candidates={[{ account: JORDAN, control: promoteControl(JORDAN, viewer) }]}
        search="jordan"
        promote={done}
        demote={done}
      />,
    );
    expect(isOff(screen.getByRole("button", { name: "Demote Sam Okafor" }))).toBe(true);
    expect(
      screen.getByText("Sam Okafor is the last active Site administrator, who cannot be demoted."),
    ).toBeTruthy();
    expect(isOff(screen.getByRole("button", { name: "Promote Jordan Lee" }))).toBe(true);
    expect(screen.getByText("Account not claimed yet")).toBeTruthy();
  });

  it("keeps the step-up dialog open with the refusal when the step-up fails", async () => {
    const promote = vi.fn((): Promise<RoleActState> =>
      Promise.resolve({
        status: "error",
        code: "STEP_UP_FAILED",
        message: t("site.accounts.error.stepUpFailed"),
      }),
    );
    const user = userEvent.setup();
    render(
      <SiteAdministratorsPanel
        administrators={[]}
        candidates={[{ account: PRIYA, control: promoteControl(PRIYA, viewer) }]}
        search="priya"
        promote={promote}
        demote={done}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Promote Priya Shah" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm to promote Priya Shah" });
    expect(dialog.textContent).toContain(t("site.stepUp.alone"));
    await user.type(within(dialog).getByLabelText(/^Password/u), "wrong");
    await user.type(within(dialog).getByLabelText(/^Second factor code/u), "123456");
    await user.click(within(dialog).getByRole("button", { name: "Promote Priya Shah" }));
    await waitFor(() => {
      expect(within(dialog).getByRole("alert").textContent).toBe(
        t("site.accounts.error.stepUpFailed"),
      );
    });
    expect(promote).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByLabelText(/^Password/u)).toHaveProperty("value", "");
  });
});
