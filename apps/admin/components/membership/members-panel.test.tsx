import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { isLastAdministrator, peopleRows } from "@/lib/membership/people";
import type { AccessGroup, MembershipActionState, WorkspaceMember } from "@/lib/membership/types";
import { WORKSPACE_ADMINISTRATION } from "@/lib/membership/workspace-views";

import { GrantForm } from "./grant-form";
import { MembersPanel, type MembersActions } from "./members-panel";

const DONE: MembershipActionState = { status: "done", message: "Done." };

const VIEWERS: AccessGroup = {
  teamId: "tm_v",
  name: "Response viewers",
  roles: ["responses.viewer"],
  environments: ["prod"],
  externalGroupId: null,
  holders: [
    { userId: "u_aiko", email: "aiko@qcms.test", suspended: true },
    { userId: "u_me", email: "me@qcms.test", suspended: true },
  ],
};

const AUTHORS: AccessGroup = {
  teamId: "tm_a",
  name: "Authors",
  roles: ["forms.editor"],
  environments: [],
  externalGroupId: null,
  holders: [{ userId: "u_aiko", email: "aiko@qcms.test", suspended: false }],
};

function member(userId: string, name: string, role = "member"): WorkspaceMember {
  return {
    userId,
    name,
    email: `${userId.slice(2)}@qcms.test`,
    role,
    status: "active",
    groups: [],
  };
}

const ROWS = peopleRows(
  [member("u_aiko", "Aiko Tanaka"), member("u_me", "Me", "forms.owner")],
  [VIEWERS, AUTHORS],
);

function actions(): MembersActions {
  return {
    setRole: vi.fn(() => Promise.resolve(DONE)),
    revoke: vi.fn(() => Promise.resolve(DONE)),
    reconfirm: vi.fn(() => Promise.resolve(DONE)),
    removeMember: vi.fn(() => Promise.resolve(DONE)),
  };
}

function renderPanel(acts = actions()) {
  render(
    <MembersPanel
      workspaceId="ws_1"
      workspaceName="Clinical"
      viewerId="u_me"
      people={ROWS}
      lastAdministrators={ROWS.filter((row) => isLastAdministrator(ROWS, row.userId)).map(
        (row) => row.userId,
      )}
      environments={["test", "prod"]}
      capabilities={WORKSPACE_ADMINISTRATION}
      filtered={false}
      message={undefined}
      grantHref="/workspaces/ws_1/members?grant=1"
      groupsHref="/workspaces/ws_1/access-groups"
      actions={acts}
    />,
  );
  return acts;
}

describe("Members", () => {
  it("lists each person's administrator flag, groups and status", () => {
    renderPanel();
    const table = screen.getByRole("table", { name: /members/iu });
    const aiko = within(table).getByRole("row", { name: /Aiko Tanaka/u });
    expect(aiko.textContent).toContain("Response viewers");
    expect(aiko.textContent).toContain("Suspended, needs re-confirmation");
    expect(aiko.textContent).toContain("No");
  });

  it("explains a person's access from live holds and offers Re-confirm for theirs", async () => {
    const user = userEvent.setup();
    const acts = renderPanel();
    await user.click(screen.getByRole("button", { name: "Open Aiko Tanaka" }));
    const sheet = screen.getByTestId("qcms-person-sheet");
    const explanation = within(sheet).getByTestId("qcms-access-explanation");
    expect(within(explanation).getByRole("row", { name: /View responses/u }).textContent).toContain(
      "No group grants this",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Re-confirm Aiko Tanaka in Response viewers" }),
    );
    await user.click(screen.getByRole("button", { name: "Re-confirm" }));
    expect(acts.reconfirm).toHaveBeenCalledWith("ws_1", "tm_v", "u_aiko", "Aiko Tanaka");
  });

  it("hides Re-confirm from the membership's own subject", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Open Me" }));
    const sheet = screen.getByTestId("qcms-person-sheet");
    expect(within(sheet).queryByRole("button", { name: /^Re-confirm/u })).toBeNull();
    expect(within(sheet).getByText(/cannot re-confirm your own membership/u)).toBeTruthy();
  });

  it("keeps the last Workspace administrator's removal off, with the reason", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Open Me" }));
    const sheet = screen.getByTestId("qcms-person-sheet");
    const remove = within(sheet).getByRole("button", {
      name: "Remove Workspace administrator, Me",
    });
    expect(remove.hasAttribute("disabled")).toBe(true);
    expect(sheet.textContent).toContain("Me is the last Workspace administrator of Clinical.");
    expect(
      within(sheet).getByRole("button", { name: "Remove from workspace" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("appoints a Workspace administrator through a named confirmation", async () => {
    const user = userEvent.setup();
    const acts = renderPanel();
    await user.click(screen.getByRole("button", { name: "Open Aiko Tanaka" }));
    await user.click(
      screen.getByRole("button", { name: "Appoint Aiko Tanaka as Workspace administrator" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Appoint Aiko Tanaka as Workspace administrator?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Appoint Aiko Tanaka" }));
    expect(acts.setRole).toHaveBeenCalledWith("ws_1", "u_aiko", "forms.owner");
  });
});

describe("Grant", () => {
  function renderGrant(
    grant: () => Promise<MembershipActionState>,
    requireSecondApprover: boolean,
  ) {
    render(
      <GrantForm
        workspaceId="ws_1"
        groups={[VIEWERS, AUTHORS]}
        people={ROWS}
        environments={["test", "prod"]}
        viewerEmail="me@qcms.test"
        requireSecondApprover={requireSecondApprover}
        initialEmail="me@qcms.test"
        initialGroup="tm_v"
        cancelHref="/workspaces/ws_1/members"
        newGroupHref="/workspaces/ws_1/access-groups?new=1"
        grant={grant}
      />,
    );
  }

  it("refuses a malformed address before sending it", async () => {
    const user = userEvent.setup();
    const grant = vi.fn(() => Promise.resolve(DONE));
    renderGrant(grant, false);
    const email = screen.getByRole("textbox", { name: "Email address" });
    await user.clear(email);
    await user.type(email, "priya.shah@");
    await user.click(screen.getByRole("button", { name: "Grant" }));
    expect(grant).not.toHaveBeenCalled();
    expect(screen.getByText("Enter an email address.")).toBeTruthy();
  });

  it("asks for an Approver for a self-grant with Second approval on, and shows it pending", async () => {
    const user = userEvent.setup();
    const grant = vi.fn(() =>
      Promise.resolve<MembershipActionState>({ status: "held", message: "Request sent." }),
    );
    renderGrant(grant, true);
    expect(screen.getByTestId("qcms-access-approval").textContent).toContain("Needs an Approver");
    await user.click(screen.getByRole("button", { name: "Request approval" }));
    expect(grant).toHaveBeenCalledWith("ws_1", "tm_v", "me@qcms.test");
    expect(await screen.findByText("Request sent.")).toBeTruthy();
    expect(screen.queryByText("Done.")).toBeNull();
  });
});
