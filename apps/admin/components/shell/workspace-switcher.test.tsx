import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceSwitcher } from "./workspace-switcher.tsx";
import { t } from "../../lib/i18n/en.ts";

vi.mock("next/navigation", () => ({
  usePathname: () => "/forms/frm_intake/rules",
  useSearchParams: () => new URLSearchParams(""),
}));

const LONG = "Northern Region Community Health Services Research";

const CHOICES = [
  { workspaceId: "org_clinical", name: "Clinical Trials" },
  { workspaceId: "org_long", name: LONG },
  { workspaceId: "org_intake", name: "Patient Intake" },
];

const CURRENT = CHOICES[2] as { workspaceId: string; name: string };

function draw(current = CURRENT) {
  return render(<WorkspaceSwitcher choices={CHOICES} current={current} secureCookies={false} />);
}

describe("the workspace switcher", () => {
  it("names the current workspace, with its visible text inside that name", () => {
    draw();
    const trigger = screen.getByRole("button", {
      name: t("workspace.switcher.trigger", { name: CURRENT.name }),
    });
    expect(trigger.textContent).toContain(CURRENT.name);
    expect(screen.getByTestId("qcms-workspace-switcher").getAttribute("title")).toBe(CURRENT.name);
  });

  it("carries the full name in the tooltip when the visible one is truncated", () => {
    draw({ workspaceId: "org_long", name: LONG });
    expect(screen.getByTestId("qcms-workspace-switcher").getAttribute("title")).toBe(LONG);
    expect(screen.getByRole("button", { name: `Workspace ${LONG}` })).toBeTruthy();
  });

  it("offers one radio row per workspace, checked on the current one", async () => {
    draw();
    await userEvent.click(screen.getByRole("button"));
    const menu = screen.getByRole("menu");
    const rows = screen.getAllByRole("menuitemradio");
    expect(menu.getAttribute("aria-label")).toBe(t("workspace.switcher.legend"));
    expect(rows.map((row) => row.textContent)).toEqual(["Clinical Trials", LONG, "Patient Intake"]);
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
  });
});
