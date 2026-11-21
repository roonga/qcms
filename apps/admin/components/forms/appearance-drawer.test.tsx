import type { Appearance } from "@roonga/qcms-core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  appearanceFromTheme,
  shippedThemeKey,
  type ThemeOption,
} from "@/lib/forms/appearance-edit";
import type { SaveAppearanceState } from "@/lib/forms/builder-state";
import { shippedThemeOptions } from "@/lib/server/appearance-options";

import { AppearanceDrawer } from "./appearance-drawer";

const SAVED: SaveAppearanceState = { status: "saved" };

const PLUM: ThemeOption = (() => {
  const found = shippedThemeOptions().find((theme) => theme.key === shippedThemeKey("plum"));
  if (found === undefined) throw new Error("Plum is not a shipped theme");
  return { ...found, name: "Plum" };
})();

const FACES = [
  { key: "system", label: "System default" },
  { key: "lexend", label: "Lexend" },
];

const APPLIED = appearanceFromTheme(PLUM, null);

function isOff(element: Element): boolean {
  return (
    (element as HTMLInputElement).disabled === true ||
    element.getAttribute("aria-disabled") === "true"
  );
}

function picker(name: RegExp): HTMLElement {
  return screen.getByRole("button", { name });
}

function drawer(
  appearance: Appearance | null,
  overrides: {
    readonly locked?: boolean;
    readonly onPreview?: (next: Appearance | null) => void;
    readonly onSave?: (next: Appearance | null) => Promise<SaveAppearanceState>;
    readonly onClose?: () => void;
  } = {},
) {
  return (
    <AppearanceDrawer
      appearance={appearance}
      themes={[PLUM]}
      faces={FACES}
      locked={overrides.locked ?? false}
      onPreview={overrides.onPreview ?? (() => undefined)}
      onSave={overrides.onSave ?? (() => Promise.resolve(SAVED))}
      onClose={overrides.onClose ?? (() => undefined)}
    />
  );
}

describe("choosing a theme", () => {
  it("reports the chosen theme's palettes for the preview to render", async () => {
    const onPreview = vi.fn();
    render(drawer(null, { onPreview }));
    await userEvent.click(picker(/Theme/u));
    await userEvent.click(await screen.findByRole("option", { name: "Plum" }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview.mock.calls[0]?.[0]).toMatchObject({ palettes: PLUM.palettes });
  });

  it("leaves every other axis off while the form has no appearance to sit on", () => {
    render(drawer(null));
    expect(isOff(screen.getByRole("button", { name: "Medium" }))).toBe(true);
    expect(isOff(picker(/Face/u))).toBe(true);
  });
});

describe("text size", () => {
  it("marks the preset the value matches and Custom for anything else", () => {
    const { rerender } = render(drawer(APPLIED));
    expect(screen.getByRole("button", { name: "Medium" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    rerender(drawer({ ...APPLIED, textSize: 21 }));
    expect(screen.getByRole("button", { name: "Custom" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("writes a preset's number into the field", async () => {
    const onPreview = vi.fn();
    render(drawer(APPLIED, { onPreview }));
    await userEvent.click(screen.getByRole("button", { name: "Large" }));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ textSize: 20 }));
  });

  it("refuses a value under the floor and keeps the last valid one applied", async () => {
    const onPreview = vi.fn();
    render(drawer(APPLIED, { onPreview }));
    const field = screen.getByTestId("qcms-appearance-text-size");
    await userEvent.clear(field);
    await userEvent.type(field, "9");
    expect(screen.getByRole("alert").textContent).toContain("16 px is the smallest");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(isOff(screen.getByTestId("qcms-appearance-done"))).toBe(true);
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("notes the scale at which the respondent's size reaches the cap", () => {
    render(drawer({ ...APPLIED, textSize: 22 }));
    expect(screen.getByTestId("qcms-appearance-cap").textContent).toContain("150%");
  });
});

describe("a locked workspace", () => {
  it("disables every control, names the reason and attempts no save", async () => {
    const onSave = vi.fn(() => Promise.resolve(SAVED));
    render(drawer(APPLIED, { locked: true, onSave }));
    const reason = screen.getByTestId("qcms-appearance-locked");
    expect(reason.textContent).toContain("A Workspace administrator can unlock it in Settings.");
    const medium = screen.getByRole("button", { name: "Medium" });
    expect(isOff(medium)).toBe(true);
    expect(medium.getAttribute("aria-describedby")).toBe(reason.id);
    expect(isOff(picker(/Theme/u))).toBe(true);
    expect(isOff(screen.getByTestId("qcms-appearance-text-size"))).toBe(true);
    const done = screen.getByTestId("qcms-appearance-done");
    expect(isOff(done)).toBe(true);
    await userEvent.click(done);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("saving", () => {
  it("sends what the preview shows and words the correction report on a refusal", async () => {
    const onSave = vi.fn(() =>
      Promise.resolve<SaveAppearanceState>({
        status: "error",
        code: "APPEARANCE_CONTRAST",
        message: "Some colour pairs do not reach their minimum contrast.",
        failures: [
          {
            palette: "lightHighContrast",
            foreground: "text-muted",
            background: "surface",
            ratio: 4.2,
            required: 7,
          },
        ],
      }),
    );
    render(drawer(APPLIED, { onSave }));
    await userEvent.click(screen.getByTestId("qcms-appearance-done"));
    expect(onSave).toHaveBeenCalledWith(APPLIED);
    const refusal = await screen.findByTestId("qcms-appearance-save-error");
    expect(refusal.textContent).toContain(
      "text-muted on surface in Light high contrast reaches 4.2:1, short of 7.0:1.",
    );
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(drawer(APPLIED, { onClose }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
