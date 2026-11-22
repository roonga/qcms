import type { Appearance } from "@roonga/qcms-core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  appearanceFromTheme,
  shippedThemeKey,
  type DerivedTheme,
  type ThemeOption,
} from "@/lib/forms/appearance-edit";
import type {
  CreateThemeState,
  DeriveThemeState,
  SaveAppearanceState,
} from "@/lib/forms/builder-state";
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

const DERIVED: DerivedTheme = {
  palettes: PLUM.palettes,
  face: "lexend",
  pageTint: true,
  logoKey: "a".repeat(64),
  corrections: [
    { palette: "light", token: "primary", from: "#4caf50", to: "#2e7d32" },
    { palette: "dark", token: "primary", from: "#4caf50", to: "#81c784" },
  ],
  tintDropped: ["darkHighContrast"],
};

const READ: DeriveThemeState = { status: "derived", derived: DERIVED, host: "www.example.org" };

const KEPT: CreateThemeState = { status: "created", themeId: "thm_read", name: "Example" };

function isOff(element: Element): boolean {
  return (
    (element as HTMLInputElement).disabled === true ||
    element.getAttribute("aria-disabled") === "true"
  );
}

function picker(name: string): HTMLSelectElement {
  return screen.getByRole<HTMLSelectElement>("combobox", { name });
}

function tint(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("checkbox", { name: /Tint the page background/u });
}

function drawer(
  appearance: Appearance | null,
  overrides: {
    readonly locked?: boolean;
    readonly handedOffAddress?: { readonly url: string; readonly nonce: number };
    readonly onDerive?: (url: string) => Promise<DeriveThemeState>;
    readonly onCreateTheme?: (
      name: string,
      look: Appearance,
      sourceHost: string | null,
    ) => Promise<CreateThemeState>;
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
      handedOffAddress={overrides.handedOffAddress}
      onDerive={overrides.onDerive ?? (() => Promise.resolve(READ))}
      onCreateTheme={overrides.onCreateTheme ?? (() => Promise.resolve(KEPT))}
      onPreview={overrides.onPreview ?? (() => undefined)}
      onSave={overrides.onSave ?? (() => Promise.resolve(SAVED))}
      onClose={overrides.onClose ?? (() => undefined)}
    />
  );
}

function address(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", { name: "Website address" });
}

function getTheme(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Get theme" });
}

describe("choosing a theme", () => {
  it("reports the chosen theme's palettes for the preview to render", async () => {
    const onPreview = vi.fn();
    render(drawer(null, { onPreview }));
    await userEvent.selectOptions(picker("Theme"), PLUM.key);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview.mock.calls[0]?.[0]).toMatchObject({ palettes: PLUM.palettes });
  });

  it("leaves every other axis off while the form has no appearance to sit on", () => {
    render(drawer(null));
    expect(isOff(screen.getByRole("button", { name: "Medium" }))).toBe(true);
    expect(isOff(picker("Face"))).toBe(true);
    expect(isOff(tint())).toBe(true);
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
  it("disables every control, points each at the one reason and attempts no save", async () => {
    const onSave = vi.fn(() => Promise.resolve(SAVED));
    render(drawer(APPLIED, { locked: true, onSave }));
    const reason = screen.getByTestId("qcms-appearance-locked");
    expect(reason.textContent).toContain("A Workspace administrator can unlock it in Settings.");
    const controls: Element[] = [
      picker("Theme"),
      picker("Face"),
      tint(),
      screen.getByTestId("qcms-appearance-text-size"),
      ...["Medium", "Custom", "Spacious", "Rounded", "None"].map((name) =>
        screen.getByRole("button", { name }),
      ),
    ];
    for (const control of controls) {
      expect(isOff(control), control.id).toBe(true);
      expect(control.getAttribute("aria-describedby"), control.id).toBe(reason.id);
    }
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

describe("reading a theme from a website", () => {
  it("offers Get theme only for a full https address", async () => {
    render(drawer(APPLIED));
    expect(isOff(getTheme())).toBe(true);
    await userEvent.type(address(), "example.org");
    expect(isOff(getTheme())).toBe(true);
    await userEvent.clear(address());
    await userEvent.type(address(), "http://www.example.org/");
    expect(isOff(getTheme())).toBe(true);
    await userEvent.clear(address());
    await userEvent.type(address(), "https://www.example.org/");
    expect(isOff(getTheme())).toBe(false);
  });

  it("derives the address typed here, and nothing else", async () => {
    const onDerive = vi.fn((_url: string) => Promise.resolve(READ));
    render(drawer(APPLIED, { onDerive }));
    await userEvent.type(address(), "https://www.example.org/");
    await userEvent.click(getTheme());
    expect(onDerive.mock.calls).toStrictEqual([["https://www.example.org/"]]);
  });

  it("previews the look it answered and reports what it kept", async () => {
    const onPreview = vi.fn();
    render(drawer(APPLIED, { onPreview }));
    await userEvent.type(address(), "https://www.example.org/");
    await userEvent.click(getTheme());
    expect(await screen.findByTestId("qcms-appearance-derive-values")).toBeTruthy();
    expect(onPreview.mock.calls.at(-1)?.[0]).toMatchObject({
      palettes: DERIVED.palettes,
      face: "lexend",
      pageTint: true,
      logo: DERIVED.logoKey,
    });
    expect(screen.getByText(/Nothing from the site is stored/u)).toBeTruthy();
  });

  it("names every colour it moved to keep the look readable", async () => {
    render(drawer(APPLIED));
    await userEvent.type(address(), "https://www.example.org/");
    await userEvent.click(getTheme());
    const report = await screen.findByTestId("qcms-appearance-derive-corrections");
    expect(report.textContent).toContain("2 colours were moved");
    expect(report.textContent).toContain("#4caf50 became #2e7d32 in Light");
    expect(report.textContent).toContain("The page tint was left off");
  });

  it("marks the derived look Not saved until it is kept as a workspace theme", async () => {
    render(drawer(APPLIED));
    await userEvent.type(address(), "https://www.example.org/");
    await userEvent.click(getTheme());
    expect((await screen.findByRole("combobox", { name: "Theme" })).textContent).toContain(
      "Not saved",
    );
    expect(screen.getByTestId("qcms-appearance-unsaved")).toBeTruthy();
  });

  it("keeps the look under the name typed here, with the host it was read from", async () => {
    const onCreateTheme = vi.fn((_name: string, _look: Appearance, _host: string | null) =>
      Promise.resolve(KEPT),
    );
    render(drawer(APPLIED, { onCreateTheme }));
    await userEvent.type(address(), "https://www.example.org/");
    await userEvent.click(getTheme());
    await userEvent.click(await screen.findByTestId("qcms-appearance-theme-save"));
    await userEvent.type(screen.getByTestId("qcms-appearance-theme-name"), "Example");
    await userEvent.click(screen.getByTestId("qcms-appearance-theme-save"));
    expect(onCreateTheme.mock.calls[0]?.[0]).toBe("Example");
    expect(onCreateTheme.mock.calls[0]?.[2]).toBe("www.example.org");
    expect(await screen.findByText("Example is a workspace theme now.")).toBeTruthy();
    expect(screen.queryByTestId("qcms-appearance-unsaved")).toBeNull();
  });

  it("restores the look that was there when the derive is cancelled", async () => {
    const onPreview = vi.fn();
    render(drawer(APPLIED, { onPreview }));
    await userEvent.type(address(), "https://www.example.org/");
    await userEvent.click(getTheme());
    await userEvent.click(await screen.findByTestId("qcms-appearance-derive-cancel"));
    expect(onPreview.mock.calls.at(-1)?.[0]).toStrictEqual(APPLIED);
    expect(screen.queryByTestId("qcms-appearance-derive-values")).toBeNull();
  });

  it("says why an address was refused and changes nothing", async () => {
    const onPreview = vi.fn();
    render(
      drawer(APPLIED, {
        onPreview,
        onDerive: () =>
          Promise.resolve<DeriveThemeState>({
            status: "error",
            code: "THEME_DERIVE_REFUSED",
            message: "That address could not be read for a theme.",
          }),
      }),
    );
    await userEvent.type(address(), "https://www.example.org/");
    await userEvent.click(getTheme());
    expect((await screen.findByTestId("qcms-appearance-derive-error")).textContent).toContain(
      "That address could not be read for a theme.",
    );
    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.queryByTestId("qcms-appearance-derive-values")).toBeNull();
  });

  it("derives the address a confirmed card handed over, already typed", async () => {
    const onDerive = vi.fn((_url: string) => Promise.resolve(READ));
    render(
      drawer(APPLIED, { onDerive, handedOffAddress: { url: "https://brand.example/", nonce: 1 } }),
    );
    expect(await screen.findByTestId("qcms-appearance-derive-values")).toBeTruthy();
    expect(address().value).toBe("https://brand.example/");
    expect(onDerive.mock.calls).toStrictEqual([["https://brand.example/"]]);
  });

  it("disables the address, Get theme and the save on a locked workspace", () => {
    render(drawer(APPLIED, { locked: true }));
    expect(isOff(address())).toBe(true);
    expect(isOff(getTheme())).toBe(true);
    expect(address().getAttribute("aria-describedby")).toContain("qcms-appearance-lock-reason");
  });
});
