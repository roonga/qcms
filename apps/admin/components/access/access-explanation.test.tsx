import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n/en";
import {
  NO_ACCESS_CAPABILITIES,
  type AccessCapabilities,
  type GroupGrant,
} from "@/lib/membership/access-patterns";

import { AccessExplanation } from "./access-explanation";

const AUTHORS: GroupGrant = {
  id: "tm_authors",
  name: "Authors",
  roles: ["forms.editor", "forms.publisher", "responses.viewer"],
  environments: ["test"],
};

const READS_ACCESS: AccessCapabilities = new Set(["access.read"]);

function renderExplanation(capabilities: AccessCapabilities) {
  render(
    <AccessExplanation
      person="Priya Shah"
      workspace="Clinical"
      groups={[AUTHORS]}
      environments={["test", "prod"]}
      capabilities={capabilities}
      groupHref={(group) => `/workspaces/ws_1/access-groups/${group.id}`}
    />,
  );
  return screen.getByRole("table", { name: "What Priya Shah can do in Clinical" });
}

function row(table: HTMLElement, action: string): readonly string[] {
  const header = within(table).getByRole("rowheader", { name: action });
  const cells = within(header.closest("tr") as HTMLElement).getAllByRole("cell");
  return cells.map((cell) => cell.textContent ?? "");
}

describe("the access explanation", () => {
  it("names the granting group per environment, or that no group grants it", () => {
    const table = renderExplanation(READS_ACCESS);
    const none = t("access.explain.noGroup");

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Action", "test", "prod"]);
    expect(row(table, "View forms")).toEqual(["Authors"]);
    expect(row(table, "Edit forms")).toEqual(["Authors"]);
    expect(row(table, "Publish forms")).toEqual(["Authors", none]);
    expect(row(table, "View responses")).toEqual(["Authors", none]);
    expect(row(table, "Erase responses")).toEqual([none, none]);
  });

  it("spans every environment for a role that ignores the environment set", () => {
    const table = renderExplanation(READS_ACCESS);
    const header = within(table).getByRole("rowheader", { name: "Edit forms" });
    const [cell] = within(header.closest("tr") as HTMLElement).getAllByRole("cell");
    expect(cell?.getAttribute("colspan")).toBe("2");
  });

  it("links a group name to the group for a caller who can see access groups", () => {
    const table = renderExplanation(READS_ACCESS);
    const links = within(table).getAllByRole("link", { name: "Authors" });
    expect(links).toHaveLength(4);
    expect(links[0]?.getAttribute("href")).toBe("/workspaces/ws_1/access-groups/tm_authors");
  });

  it("renders no link for a caller who cannot see access groups", () => {
    const table = renderExplanation(NO_ACCESS_CAPABILITIES);
    expect(within(table).queryAllByRole("link")).toEqual([]);
    expect(row(table, "Edit forms")).toEqual(["Authors"]);
  });
});
