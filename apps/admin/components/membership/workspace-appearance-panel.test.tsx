import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MembershipActionState } from "@/lib/membership/types";
import { shippedThemeOptions } from "@/lib/server/appearance-options";

import { WorkspaceAppearancePanel, type WorkspaceThemeRow } from "./workspace-appearance-panel";

const DONE: MembershipActionState = { status: "done", message: "ok" };

const PALETTES = shippedThemeOptions()[0]?.palettes;
if (PALETTES === undefined) throw new Error("no shipped theme to borrow palettes from");

const THEME: WorkspaceThemeRow = {
  themeId: "thm_1",
  name: "Clinical blue",
  palettes: PALETTES,
  logoKey: null,
  sourceHost: null,
};

const LOCK = /Lock appearance/u;

function isOff(element: Element): boolean {
  return (
    (element as HTMLInputElement).disabled === true ||
    element.getAttribute("aria-disabled") === "true"
  );
}

function panel(
  overrides: {
    readonly themes?: readonly WorkspaceThemeRow[] | undefined;
    readonly locked?: boolean | undefined;
    readonly canEditForms?: boolean;
    readonly canSetLock?: boolean;
    readonly rename?: (
      workspaceId: string,
      themeId: string,
      name: string,
    ) => Promise<MembershipActionState>;
    readonly remove?: (workspaceId: string, themeId: string) => Promise<MembershipActionState>;
    readonly setLock?: (workspaceId: string, locked: boolean) => Promise<MembershipActionState>;
  } = {},
) {
  return (
    <WorkspaceAppearancePanel
      workspaceId="ws_1"
      themes={"themes" in overrides ? overrides.themes : [THEME]}
      locked={"locked" in overrides ? overrides.locked : false}
      canEditForms={overrides.canEditForms ?? true}
      canSetLock={overrides.canSetLock ?? true}
      rename={overrides.rename ?? (() => Promise.resolve(DONE))}
      remove={overrides.remove ?? (() => Promise.resolve(DONE))}
      uploadLogo={() => Promise.resolve(DONE)}
      setLock={overrides.setLock ?? (() => Promise.resolve(DONE))}
    />
  );
}

describe("the appearance lock", () => {
  it("is set by an administrator", async () => {
    const setLock = vi.fn(() => Promise.resolve(DONE));
    render(panel({ setLock }));
    await userEvent.click(screen.getByRole("switch", { name: LOCK }));
    expect(setLock).toHaveBeenCalledWith("ws_1", true);
  });

  it("is off to anyone else, with the role it needs", () => {
    render(panel({ canSetLock: false }));
    expect(isOff(screen.getByRole("switch", { name: LOCK }))).toBe(true);
    expect(screen.getByText("Needs Workspace administrator.")).not.toBeNull();
  });

  it("claims no state when the settings read was refused", () => {
    render(panel({ locked: undefined }));
    expect(isOff(screen.getByRole("switch", { name: LOCK }))).toBe(true);
  });
});

describe("the themes list", () => {
  it("renames a theme", async () => {
    const rename = vi.fn(() => Promise.resolve(DONE));
    render(panel({ rename }));
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    const field = screen.getByLabelText("Theme name");
    await userEvent.clear(field);
    await userEvent.type(field, "Clinical teal");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(rename).toHaveBeenCalledWith("ws_1", "thm_1", "Clinical teal");
  });

  it("asks before deleting and says what deleting does not take away", async () => {
    const remove = vi.fn(() => Promise.resolve(DONE));
    render(panel({ remove }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByTestId("qcms-theme-delete-confirm").textContent).toContain(
      "Forms already using it keep the look they copied.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete theme" }));
    expect(remove).toHaveBeenCalledWith("ws_1", "thm_1");
  });

  it("offers no act to a holder without Edit forms, and says which role it needs", () => {
    render(panel({ canEditForms: false }));
    for (const name of ["Rename", "Change logo", "Delete"]) {
      expect(isOff(screen.getByRole("button", { name }))).toBe(true);
    }
    expect(screen.getByText("Needs Edit forms.")).not.toBeNull();
  });

  it("says nothing about what exists when the themes read was refused", () => {
    render(panel({ themes: undefined }));
    expect(screen.queryByTestId("qcms-themes")).toBeNull();
    expect(screen.getByText("Themes are not available to you in this workspace.")).not.toBeNull();
  });

  it("names where a theme is created, since Settings does not create one", () => {
    render(panel({ themes: [] }));
    expect(
      screen.getByText("A theme is saved from a form's Appearance drawer in the agent builder."),
    ).not.toBeNull();
  });
});
