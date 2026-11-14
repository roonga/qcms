import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AccessGroupList, MembershipActionState } from "@/lib/membership/types";

import { AccessGroupsPanel } from "./access-groups-panel";

const DONE: MembershipActionState = { status: "done", message: "ok" };

const GROUP_NAME = "Response viewers";

const LIST: AccessGroupList = {
  workspaceId: "ws_1",
  groups: [
    {
      teamId: "tm_1",
      name: GROUP_NAME,
      roles: ["responses.viewer"],
      environments: ["test"],
      externalGroupId: null,
      holders: [{ userId: "u1", email: "held@qcms.test" }],
    },
  ],
};

function renderPanel(create = vi.fn(() => Promise.resolve(DONE))) {
  render(
    <AccessGroupsPanel
      list={LIST}
      message={undefined}
      environments={["dev", "test", "prod"]}
      members={[
        { userId: "u1", email: "held@qcms.test", name: "Held" },
        { userId: "u2", email: "free@qcms.test", name: "Free" },
      ]}
      create={create}
      remove={vi.fn(() => Promise.resolve(DONE))}
      grant={vi.fn(() => Promise.resolve(DONE))}
      revoke={vi.fn(() => Promise.resolve(DONE))}
    />,
  );
  return create;
}

/* React Aria paints the role list in a popover, which is overlay layout and belongs in Playwright
   (ADR-23); the select it keeps for form submission carries the same options. */
function chooseRole(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  const option = screen.getByRole("option", { name, hidden: true });
  const field = option.closest("select");
  if (field === null) throw new Error(`the role ${name} is on no select`);
  return user.selectOptions(field, option);
}

describe("the access-group form", () => {
  it("types no environment or account: every pick is a control", () => {
    renderPanel();
    const textboxes = screen.getAllByRole("textbox").map((box) => box.getAttribute("type"));
    expect(screen.queryByLabelText(/one id per line/iu)).toBeNull();
    expect(screen.queryByLabelText("Account address")).toBeNull();
    expect(textboxes).not.toContain("email");
    expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy();
  });

  it("names a group by its own label and says its roles and environments in words", () => {
    renderPanel();
    const row = screen.getByText(GROUP_NAME).closest("li");
    expect(row).not.toBeNull();
    const scope = within(row as HTMLElement);
    expect(scope.getByText("Response viewer, in test")).toBeTruthy();
    expect(scope.queryByText("responses.viewer")).toBeNull();
    expect(scope.getByText("Response viewer")).toBeTruthy();
  });

  it("offers only members who do not hold the group yet", () => {
    renderPanel();
    const row = screen.getByText(GROUP_NAME).closest("li") as HTMLElement;
    const options = within(row).getAllByRole("option", { hidden: true });
    expect(
      options.map((option) => option.textContent?.trim()).filter((text) => text !== ""),
    ).toEqual(["free@qcms.test"]);
  });

  it("offers no environment picker while the chosen role applies everywhere", () => {
    renderPanel();
    expect(screen.getByTestId("qcms-group-no-environments")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "test" })).toBeNull();
  });

  it("asks for environments as soon as the chosen role needs them", async () => {
    const user = userEvent.setup();
    renderPanel();
    await chooseRole(user, "Form publisher");
    for (const environment of ["dev", "test", "prod"]) {
      expect(screen.getByRole("checkbox", { name: environment })).toBeTruthy();
    }
    expect(screen.queryByTestId("qcms-group-no-environments")).toBeNull();
  });

  it("creates with the typed name and the ticked environments, in the installation's order", async () => {
    const user = userEvent.setup();
    const create = renderPanel();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "  Publishers  ");
    await chooseRole(user, "Form publisher");
    await user.click(screen.getByRole("checkbox", { name: "prod" }));
    await user.click(screen.getByRole("checkbox", { name: "dev" }));

    await user.click(screen.getByRole("button", { name: "Create group" }));
    expect(create).toHaveBeenCalledWith("ws_1", {
      name: "Publishers",
      roles: ["forms.publisher"],
      environments: ["dev", "prod"],
    });
  });

  it("holds the create back until the group has a name and, where needed, an environment", async () => {
    const user = userEvent.setup();
    renderPanel();
    const submit = screen.getByRole("button", { name: "Create group" });
    expect(submit.hasAttribute("disabled")).toBe(true);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Authors");
    expect(submit.hasAttribute("disabled")).toBe(false);

    await chooseRole(user, "Response eraser");
    expect(submit.hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: "prod" }));
    expect(submit.hasAttribute("disabled")).toBe(false);
  });
});
