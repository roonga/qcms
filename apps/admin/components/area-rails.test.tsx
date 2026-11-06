import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspacesRail } from "./membership/workspaces-rail.tsx";
import { RailFrame, RailTree } from "./rail-frame.tsx";
import { operationsRailItems } from "../lib/shell/area-rails.ts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => null,
}));

function itemKeys(items: readonly { readonly key: string }[]): string[] {
  return items.map((item) => item.key);
}

describe("an area's rail", () => {
  it("keeps its top-level items whichever of them is current", () => {
    expect(itemKeys(operationsRailItems("forms", true))).toEqual(
      itemKeys(operationsRailItems("erasure-log", true)),
    );
  });

  it("shows the installation queues only to a caller who may open them", () => {
    expect(itemKeys(operationsRailItems("forms", false))).toEqual([]);
    expect(itemKeys(operationsRailItems("forms", true))).toEqual([
      "queue:delivery-failures",
      "queue:erasure-log",
    ]);
    expect(itemKeys(operationsRailItems("delivery-failures", false))).toEqual([
      "queue:delivery-failures",
    ]);
  });

  it("is a tree: the current item marked, an expandable one saying whether it is open", () => {
    render(
      <RailFrame
        subject="Operations"
        sections={
          <RailTree
            items={operationsRailItems("delivery-failures", true).map((item) =>
              item.current
                ? { ...item, expanded: true, children: <ul data-testid="sub-items" /> }
                : item,
            )}
          />
        }
      />,
    );
    const rail = screen.getByRole("complementary", { name: "Operations" });
    const current = within(rail).getByRole("link", { current: "page" });
    expect(current.textContent).toBe("Delivery failures");
    expect(current.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(rail).getByRole("link", { name: "Erasure log" }).hasAttribute("aria-expanded"),
    ).toBe(false);
    expect(screen.getByTestId("sub-items")).toBeTruthy();
    expect(rail.querySelector(".qcms-rail__back")).toBeNull();
  });

  it("carries no title of its own, so it never repeats the page's heading", () => {
    render(
      <RailFrame
        subject="Operations"
        sections={<RailTree items={operationsRailItems("forms", true)} />}
      />,
    );
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
    const open = rail.querySelectorAll(".qcms-rail__accordion[open] > summary");
    expect(Array.from(open).map((summary) => summary.textContent)).toEqual(["Alpha"]);
    expect(rail.querySelectorAll(".qcms-rail__accordion")).toHaveLength(2);
    expect(within(rail).getByRole("link", { current: "page" }).textContent).toBe("Access audit");
  });
});
