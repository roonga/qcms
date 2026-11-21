import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { messageForFormCode } from "@/lib/forms/errors";
import { LOGO_MAX_BYTES } from "@/lib/forms/logo";
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
    readonly uploadLogo?: (
      workspaceId: string,
      themeId: string,
      bytesBase64: string,
    ) => Promise<MembershipActionState>;
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
      uploadLogo={overrides.uploadLogo ?? (() => Promise.resolve(DONE))}
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

  it("is off to anyone else, with the role it needs on the switch itself", () => {
    render(panel({ canSetLock: false }));
    const lock = screen.getByRole("switch", { name: LOCK });
    expect(isOff(lock)).toBe(true);
    const needs = screen.getByText("Needs Workspace administrator.");
    expect(lock.getAttribute("aria-describedby")).toBe(needs.id);
  });

  it("shows an Edit forms holder the state the themes read carried", () => {
    render(panel({ canSetLock: false, locked: true }));
    const lock = screen.getByRole("switch", { name: LOCK });
    expect(isOff(lock)).toBe(true);
    expect((lock as HTMLInputElement).checked).toBe(true);
  });

  it("claims no state when neither read answered", () => {
    render(panel({ locked: undefined }));
    expect(isOff(screen.getByRole("switch", { name: LOCK }))).toBe(true);
  });
});

/** A `File` that reports a size without holding the bytes, so the guard is what is measured. */
function sizedFile(bytes: number): File {
  const file = new File([new Uint8Array(1)], "logo.png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

describe("the theme logo", () => {
  it("offers only the image types the upload route re-encodes", () => {
    render(panel());
    expect(screen.getByTestId("qcms-theme-logo-input").getAttribute("accept")).toBe(
      "image/png,image/jpeg",
    );
  });

  it("sends the chosen image and reports the save", async () => {
    const uploadLogo = vi.fn(() => Promise.resolve(DONE));
    render(panel({ uploadLogo }));
    await userEvent.upload(
      screen.getByTestId("qcms-theme-logo-input"),
      new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" }),
    );
    await waitFor(() => {
      expect(uploadLogo).toHaveBeenCalledWith("ws_1", "thm_1", "AQID");
    });
    expect(await screen.findByText("ok")).not.toBeNull();
  });

  it("refuses an oversized image here rather than posting it for a 413", async () => {
    const uploadLogo = vi.fn(() => Promise.resolve(DONE));
    render(panel({ uploadLogo }));
    await userEvent.upload(
      screen.getByTestId("qcms-theme-logo-input"),
      sizedFile(LOGO_MAX_BYTES + 1),
    );
    expect(await screen.findByText(/over 512 KB/u)).not.toBeNull();
    expect(uploadLogo).not.toHaveBeenCalled();
  });

  it("refuses an empty file the same way", async () => {
    const uploadLogo = vi.fn(() => Promise.resolve(DONE));
    render(panel({ uploadLogo }));
    await userEvent.upload(screen.getByTestId("qcms-theme-logo-input"), sizedFile(0));
    expect(await screen.findByText("That file is empty. Pick an image.")).not.toBeNull();
    expect(uploadLogo).not.toHaveBeenCalled();
  });

  it("words every refusal the upload route can answer with, raw code and all", () => {
    const codes = [
      "INVALID_LOGO",
      "LOGO_NOT_RASTER",
      "LOGO_UNSUPPORTED",
      "LOGO_TOO_LARGE",
      "LOGO_TOO_MANY_PIXELS",
      "LOGO_TAKEN_DOWN",
      "LOGO_UNKNOWN",
    ];
    for (const code of codes) {
      const message = messageForFormCode(code);
      expect(message, code).not.toContain(code);
      expect(message, code).not.toContain("The request failed");
    }
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
