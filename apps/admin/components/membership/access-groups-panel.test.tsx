import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AccessGroupList, MembershipActionState } from "@/lib/membership/types";

import { AccessGroupsPanel } from "./access-groups-panel";

const DONE: MembershipActionState = { status: "done", message: "ok" };

const LIST: AccessGroupList = {
  workspaceId: "ws_1",
  scopeNote: "",
  groups: [
    {
      teamId: "tm_1",
      name: "test.forms.approver",
      fullName: "ws.test.forms.approver",
      directoryName: "qcms.ws.test.forms.approver",
      role: "forms.approver",
      environments: ["test"],
      forms: ["frm_a"],
      externalGroupId: null,
      holders: [{ userId: "u1", email: "held@qcms.test" }],
    },
  ],
};

function renderPanel(create = vi.fn(async () => DONE)) {
  render(
    <AccessGroupsPanel
      list={LIST}
      message={undefined}
      environments={["dev", "test", "prod"]}
      forms={[
        { formId: "frm_a", name: "claims" },
        { formId: "frm_b", name: "signup" },
      ]}
      members={[
        { userId: "u1", email: "held@qcms.test", name: "Held" },
        { userId: "u2", email: "free@qcms.test", name: "Free" },
      ]}
      create={create}
      remove={vi.fn(async () => DONE)}
      grant={vi.fn(async () => DONE)}
      revoke={vi.fn(async () => DONE)}
    />,
  );
  return create;
}

describe("the access-group form", () => {
  it("types no environment, form or account: every scope is a picker", () => {
    renderPanel();
    const textboxes = screen.getAllByRole("textbox").map((box) => box.getAttribute("type"));
    expect(screen.queryByLabelText(/one id per line/iu)).toBeNull();
    expect(screen.queryByLabelText("Account address")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Search forms by name" })).toBeTruthy();
    expect(textboxes).not.toContain("email");
    for (const environment of ["dev", "test", "prod"]) {
      expect(screen.getByRole("checkbox", { name: environment })).toBeTruthy();
    }
  });

  it("reads a group's role by its plain name, its forms by name", () => {
    renderPanel();
    const row = screen.getByText("test.forms.approver").closest("li");
    expect(row).not.toBeNull();
    const scope = within(row as HTMLElement);
    expect(scope.getByText("Release approver")).toBeTruthy();
    expect(scope.queryByText("forms.approver")).toBeNull();
    expect(scope.getByText("claims")).toBeTruthy();
  });

  it("offers only members who do not hold the group yet", () => {
    renderPanel();
    const row = screen.getByText("test.forms.approver").closest("li") as HTMLElement;
    const options = within(row).getAllByRole("option", { hidden: true });
    expect(
      options.map((option) => option.textContent?.trim()).filter((text) => text !== ""),
    ).toEqual(["free@qcms.test"]);
  });

  it("creates with the derived name and the picked scopes, in the installation's order", async () => {
    const user = userEvent.setup();
    const create = renderPanel();
    await user.click(screen.getByRole("checkbox", { name: /All environments/u }));
    await user.click(screen.getByRole("checkbox", { name: "prod" }));
    await user.click(screen.getByRole("checkbox", { name: "dev" }));
    await user.click(screen.getByRole("checkbox", { name: /All forms/u }));
    await user.click(screen.getByRole("checkbox", { name: "signup" }));
    expect(screen.getByTestId("qcms-group-name").textContent).toContain("dev-prod.forms.viewer");

    await user.click(screen.getByRole("button", { name: "Create group" }));
    expect(create).toHaveBeenCalledWith("ws_1", {
      name: "dev-prod.forms.viewer",
      role: "forms.viewer",
      environments: ["dev", "prod"],
      forms: ["frm_b"],
    });
  });
});
