import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MyAccess } from "@/lib/membership/types";
import { NO_CAPABILITIES } from "@/lib/shell/modes";

import { MyAccessPanel } from "./my-access-panel";

const MINE: MyAccess = {
  userId: "usr_priya",
  installationAdmin: false,
  capabilities: NO_CAPABILITIES,
  siteAdministrators: [],
  multipleWorkspaces: false,
  workspaces: [
    {
      workspaceId: "org_clinical",
      slug: "clinical",
      name: "Clinical",
      archived: false,
      memberRole: "member",
      grants: [
        {
          name: "Authors",
          roles: ["forms.editor", "forms.publisher", "responses.viewer"],
          environments: ["test"],
        },
      ],
      environments: ["test"],
    },
    {
      workspaceId: "org_finance",
      slug: "finance",
      name: "Finance",
      archived: false,
      memberRole: "forms.owner",
      grants: [],
      environments: [],
    },
  ],
};

function renderPanel(access: MyAccess = MINE) {
  render(<MyAccessPanel access={access} message={undefined} environments={["test", "prod"]} />);
}

function cells(table: HTMLElement, action: string): readonly string[] {
  const header = within(table).getByRole("rowheader", { name: action });
  return within(header.closest("tr") as HTMLElement)
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");
}

describe("My access", () => {
  it("gives each workspace its own section, with the administrator answer and the groups", () => {
    renderPanel();
    const clinical = screen.getByRole("region", { name: "Clinical" });
    expect(clinical.textContent).toContain("Workspace administrator: No");
    expect(clinical.textContent).toContain("Access groups: Authors");

    const finance = screen.getByRole("region", { name: "Finance" });
    expect(finance.textContent).toContain("Workspace administrator: Yes");
    expect(finance.textContent).toContain("You have no access in Finance.");
    expect(within(finance).queryByRole("table")).toBeNull();
  });

  it("explains each action by environment, naming the granting group or none", () => {
    renderPanel();
    const table = screen.getByRole("table", { name: "What you can do in Clinical" });
    expect(cells(table, "Edit forms")).toStrictEqual(["Authors"]);
    expect(cells(table, "Publish forms")).toStrictEqual(["Authors", "No group grants this"]);
    expect(cells(table, "Erase responses")).toStrictEqual([
      "No group grants this",
      "No group grants this",
    ]);
  });

  it("links no group, because a group's page is not the caller's to open", () => {
    renderPanel();
    const table = screen.getByRole("table", { name: "What you can do in Clinical" });
    expect(within(table).queryAllByRole("link")).toHaveLength(0);
  });

  it("says when the read failed rather than claiming the caller holds nothing", () => {
    render(<MyAccessPanel access={undefined} message="Unavailable" environments={[]} />);
    expect(screen.getByRole("alert").textContent).toContain("Your access could not be read");
    expect(screen.queryByText(/no access/u)).toBeNull();
  });
});
