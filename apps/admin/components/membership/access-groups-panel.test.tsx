import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { environmentLabel } from "@/lib/environment";
import type { AccessGroup, AccessGroupList, MembershipActionState } from "@/lib/membership/types";
import { WORKSPACE_ADMINISTRATION } from "@/lib/membership/workspace-views";

import { AccessGroupsPanel, type AccessGroupsActions } from "./access-groups-panel";

const DONE: MembershipActionState = { status: "done", message: "Saved." };

function group(
  teamId: string,
  name: string,
  roles: readonly string[],
  environments: readonly string[],
  holders: AccessGroup["holders"] = [],
): AccessGroup {
  return { teamId, name, roles, environments, externalGroupId: null, holders };
}

const STARTERS: AccessGroupList = {
  workspaceId: "ws_1",
  groups: [
    group(
      "tm_a",
      "Authors",
      ["forms.editor", "forms.publisher", "responses.viewer"],
      ["test"],
      [{ userId: "u_me", email: "me@qcms.test", suspended: false }],
    ),
    group("tm_p", "Publishers", ["forms.publisher"], ["prod"]),
    group(
      "tm_v",
      "Response viewers",
      ["responses.viewer"],
      ["prod"],
      [
        { userId: "u_aiko", email: "aiko@qcms.test", suspended: true },
        { userId: "u_me", email: "me@qcms.test", suspended: true },
      ],
    ),
    group("tm_e", "Response erasers", ["responses.eraser"], ["prod"]),
    group("tm_r", "Reviewers", ["forms.viewer"], []),
  ],
};

function actions(overrides: Partial<AccessGroupsActions> = {}): AccessGroupsActions {
  return {
    update: vi.fn(() => Promise.resolve(DONE)),
    remove: vi.fn(() => Promise.resolve(DONE)),
    revoke: vi.fn(() => Promise.resolve(DONE)),
    reconfirm: vi.fn(() => Promise.resolve(DONE)),
    ...overrides,
  };
}

function renderPanel(
  list: AccessGroupList,
  options: {
    readonly acts?: AccessGroupsActions;
    readonly requireSecondApprover?: boolean;
    readonly initialGroup?: string;
  } = {},
) {
  const acts = options.acts ?? actions();
  render(
    <AccessGroupsPanel
      list={list}
      message={undefined}
      environments={["test", "prod"]}
      viewerId="u_me"
      requireSecondApprover={options.requireSecondApprover ?? false}
      capabilities={WORKSPACE_ADMINISTRATION}
      initialGroup={options.initialGroup}
      newHref="/workspaces/ws_1/access-groups?new=1"
      grantHref="/workspaces/ws_1/members?grant=1"
      names={{ u_aiko: "Aiko Tanaka", u_me: "Me" }}
      actions={acts}
    />,
  );
  return acts;
}

describe("Access groups", () => {
  it("lists each group's roles, environments and people", () => {
    renderPanel(STARTERS);
    const table = screen.getByRole("table", { name: /access groups/iu });
    const reviewers = within(table).getByRole("row", { name: /Reviewers/u });
    expect(reviewers.textContent).toContain("View forms");
    expect(reviewers.textContent).toContain("every environment");
    expect(reviewers.textContent).toContain("Nobody");
    expect(within(table).getByRole("row", { name: /Response viewers/u }).textContent).toContain(
      "Suspended, needs re-confirmation",
    );
  });

  it("names a role no group grants once a starter group is gone (criterion 96)", () => {
    renderPanel({
      workspaceId: "ws_1",
      groups: STARTERS.groups.filter((entry) => entry.teamId !== "tm_e"),
    });
    expect(screen.getByTestId("qcms-uncovered-notice").textContent).toContain(
      "Erase responses: no group grants it yet.",
    );
  });

  it("says before deleting a starter group what it leaves uncovered (criterion 96)", async () => {
    const user = userEvent.setup();
    const acts = renderPanel(STARTERS, { initialGroup: "tm_e" });
    await user.click(screen.getByRole("button", { name: "Delete group" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Response erasers?" });
    expect(within(dialog).getByTestId("qcms-group-delete-preview").textContent).toContain(
      "Nobody will hold Erase responses through any group",
    );
    await user.click(within(dialog).getByRole("button", { name: "Delete Response erasers" }));
    expect(acts.remove).toHaveBeenCalledWith("ws_1", "tm_e");
  });
});

describe("changing a group", () => {
  it("offers environments only once a role reads them, and saves no unticked one (criterion 15)", async () => {
    const user = userEvent.setup();
    const acts = renderPanel(STARTERS, { initialGroup: "tm_r" });
    await user.click(screen.getByRole("button", { name: "Change" }));
    const form = screen.getByTestId("qcms-group-form");
    expect(within(form).getByTestId("qcms-group-no-environments")).toBeTruthy();
    expect(within(form).queryByRole("checkbox", { name: environmentLabel("prod") })).toBeNull();

    await user.click(within(form).getByRole("checkbox", { name: "View responses" }));
    expect(
      within(form).getByRole<HTMLInputElement>("checkbox", { name: environmentLabel("prod") })
        .checked,
    ).toBe(false);
    await user.click(within(form).getByRole("button", { name: "Save group" }));
    expect(within(form).getByRole("alert").textContent).toContain(
      "Choose at least one environment for Publish forms, View responses or Erase responses.",
    );
    expect(acts.update).not.toHaveBeenCalled();

    await user.click(within(form).getByRole("checkbox", { name: environmentLabel("prod") }));
    await user.click(within(form).getByRole("button", { name: "Save group" }));
    expect(acts.update).toHaveBeenCalledWith("ws_1", "tm_r", {
      name: "Reviewers",
      roles: ["forms.viewer", "responses.viewer"],
      environments: ["prod"],
    });
  });

  it("renames a group and keeps its environment set exactly", async () => {
    const user = userEvent.setup();
    const acts = renderPanel(STARTERS, { initialGroup: "tm_a" });
    await user.click(screen.getByRole("button", { name: "Change" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Builders");
    await user.click(screen.getByRole("button", { name: "Save group" }));
    expect(acts.update).toHaveBeenCalledWith("ws_1", "tm_a", {
      name: "Builders",
      roles: ["forms.editor", "forms.publisher", "responses.viewer"],
      environments: ["test"],
    });
    // The saved answer belongs to the list, so the sheet must not be left over it.
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(screen.queryByTestId("qcms-group-sheet")).toBeNull();
  });

  it("holds a response environment added to the actor's own group, and shows it pending", async () => {
    const user = userEvent.setup();
    const held: MembershipActionState = { status: "held", message: "Request sent." };
    const acts = renderPanel(STARTERS, {
      initialGroup: "tm_a",
      requireSecondApprover: true,
      acts: actions({ update: vi.fn(() => Promise.resolve(held)) }),
    });
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.click(screen.getByRole("checkbox", { name: environmentLabel("prod") }));
    expect(screen.getByTestId("qcms-access-approval").textContent).toContain("Needs an Approver");
    await user.click(screen.getByRole("button", { name: "Request approval" }));
    expect(acts.update).toHaveBeenCalledOnce();
    expect(await screen.findByText("Request sent.")).toBeTruthy();
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("applies the same edit at once for an administrator not in the group", async () => {
    const user = userEvent.setup();
    renderPanel(STARTERS, { initialGroup: "tm_p", requireSecondApprover: true });
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.click(screen.getByRole("checkbox", { name: "View responses" }));
    expect(screen.queryByTestId("qcms-access-approval")).toBeNull();
    expect(screen.getByRole("button", { name: "Save group" })).toBeTruthy();
  });
});

describe("re-confirming in a group", () => {
  it("is offered for another person's suspended membership and never for your own", async () => {
    const user = userEvent.setup();
    const acts = renderPanel(STARTERS, { initialGroup: "tm_v" });
    const sheet = screen.getByTestId("qcms-group-sheet");
    expect(
      within(sheet).queryByRole("button", { name: "Re-confirm Me in Response viewers" }),
    ).toBeNull();
    expect(within(sheet).getByText(/cannot re-confirm your own membership/u)).toBeTruthy();

    await user.click(
      within(sheet).getByRole("button", { name: "Re-confirm Aiko Tanaka in Response viewers" }),
    );
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Re-confirm Aiko Tanaka in Response viewers?" }),
      ).getByRole("button", { name: "Re-confirm" }),
    );
    expect(acts.reconfirm).toHaveBeenCalledWith("ws_1", "tm_v", "u_aiko", "Aiko Tanaka");
  });
});
