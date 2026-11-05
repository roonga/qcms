import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspacesRail } from "./membership/workspaces-rail.tsx";
import { RailFrame, RailTree } from "./rail-frame.tsx";
import {
  formsRailItems,
  operationsRailItems,
  questionsRailItems,
} from "../lib/shell/area-rails.ts";

function itemKeys(items: readonly { readonly key: string }[]): string[] {
  return items.map((item) => item.key);
}

describe("an area's rail", () => {
  it("keeps its top-level items whichever of them is current", () => {
    expect(itemKeys(questionsRailItems("all"))).toEqual(itemKeys(questionsRailItems("new")));
    expect(itemKeys(formsRailItems("all"))).toEqual(itemKeys(formsRailItems("new")));
    expect(itemKeys(operationsRailItems("forms", true))).toEqual(
      itemKeys(operationsRailItems("erasure-log", true)),
    );
    expect(questionsRailItems("new").filter((item) => item.current)).toHaveLength(1);
  });

  it("shows the installation queues only to a caller who may open them", () => {
    expect(itemKeys(operationsRailItems("forms", false))).toEqual(["section:forms"]);
    expect(itemKeys(operationsRailItems("forms", true))).toEqual([
      "section:forms",
      "queue:delivery-failures",
      "queue:erasure-log",
    ]);
    expect(itemKeys(operationsRailItems("delivery-failures", false))).toEqual([
      "section:forms",
      "queue:delivery-failures",
    ]);
  });

  it("is a tree: the current item marked, an expandable one saying whether it is open", () => {
    render(
      <RailFrame
        subject="Questions"
        sections={
          <RailTree
            items={questionsRailItems("new").map((item) =>
              item.current
                ? { ...item, expanded: true, children: <ul data-testid="sub-items" /> }
                : item,
            )}
          />
        }
      />,
    );
    const rail = screen.getByRole("complementary", { name: "Questions" });
    const current = within(rail).getByRole("link", { current: "page" });
    expect(current.textContent).toBe("New question");
    expect(current.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(rail).getByRole("link", { name: "All questions" }).hasAttribute("aria-expanded"),
    ).toBe(false);
    expect(screen.getByTestId("sub-items")).toBeTruthy();
    expect(rail.querySelector(".qcms-rail__back")).toBeNull();
  });

  it("carries no title of its own, so it never repeats the page's heading", () => {
    render(<RailFrame subject="Forms" sections={<RailTree items={formsRailItems("all")} />} />);
    const summary = screen.getByTestId("qcms-rail-label");
    expect(summary.textContent).toBe("Menu");
    expect(summary.closest("summary")?.className).toContain("qcms-rail__summary--area");
  });

  it("draws the Workspaces tree with no back link and no title", () => {
    render(
      <WorkspacesRail
        workspaces={[
          { workspaceId: "org_a", name: "Alpha" },
          { workspaceId: "org_b", name: "Beta" },
        ]}
        selected={{ workspaceId: "org_a", section: "audit" }}
      />,
    );
    const rail = screen.getByTestId("qcms-workspaces-rail");
    expect(rail.querySelector(".qcms-rail__back")).toBeNull();
    expect(screen.getByTestId("qcms-rail-label").textContent).toBe("Menu");
    expect(within(rail).getByRole("link", { name: "Alpha" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(within(rail).getByRole("link", { name: "Beta" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(within(rail).getByRole("link", { current: "page" }).textContent).toBe("Access audit");
  });
});
