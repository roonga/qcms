import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProposalSeamProvider, useProposalSeam } from "@/lib/agent/waiting";
import {
  appearanceFromTheme,
  shippedThemeKey,
  type ThemeOption,
} from "@/lib/forms/appearance-edit";
import type {
  CreateThemeState,
  DeriveThemeState,
  SaveAppearanceState,
} from "@/lib/forms/builder-state";
import type { DraftForm } from "@/lib/forms/types";
import { shippedThemeOptions } from "@/lib/server/appearance-options";

import { BuilderPreview, type BuilderPreviewSource } from "./builder-preview";

/*
 * A confirmed `theme.derive` card hands its address to this component. The API withholds the
 * kind while `QCMS_FLAG_THEME_DERIVE` is off, so the flag-off case here is defence: it proves
 * the hand-off is never swallowed, and that nothing is fetched for it either.
 */

const DRAFT: DraftForm = {
  formId: "frm_a",
  defaultLocale: "en",
  title: { en: "Intake" },
  steps: [{ stepId: "stp_a", title: { en: "About you" }, items: [] }],
  rules: [],
};

const PLUM: ThemeOption = (() => {
  const found = shippedThemeOptions().find((theme) => theme.key === shippedThemeKey("plum"));
  if (found === undefined) throw new Error("Plum is not a shipped theme");
  return { ...found, name: "Plum" };
})();

const SAVED: SaveAppearanceState = { status: "saved" };
const KEPT: CreateThemeState = { status: "created", themeId: "thm_read", name: "Example" };
const REFUSED: DeriveThemeState = { status: "error", code: "THEME_DERIVE_REFUSED", message: "No" };

function source(overrides: Partial<BuilderPreviewSource> = {}): BuilderPreviewSource {
  return {
    draft: DRAFT,
    preview: () => Promise.reject(new TypeError("fetch failed")),
    defaultTheme: "slate",
    appearance: appearanceFromTheme(PLUM, null),
    brand: { name: undefined, logoSrc: undefined },
    themes: [PLUM],
    faces: [{ key: "system", label: "System default" }],
    appearanceLocked: false,
    deriveEnabled: true,
    saveAppearance: () => Promise.resolve(SAVED),
    deriveTheme: () => Promise.resolve(REFUSED),
    createTheme: () => Promise.resolve(KEPT),
    ...overrides,
  };
}

function Host({ built }: { readonly built: BuilderPreviewSource }) {
  const seam = useProposalSeam();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          seam?.requestHandOff("appearance.derive", { url: "https://brand.example/" });
        }}
      >
        hand off
      </button>
      <BuilderPreview formId="frm_a" draft={DRAFT} source={built} />
    </>
  );
}

function host(overrides: Partial<BuilderPreviewSource> = {}) {
  return (
    <ProposalSeamProvider onReview={() => undefined}>
      <Host built={source(overrides)} />
    </ProposalSeamProvider>
  );
}

async function handOff(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "hand off" }));
}

describe("a confirmed derive card handed to the builder preview", () => {
  it("opens the drawer on the address and reads the website with the flag on", async () => {
    const deriveTheme = vi.fn<(url: string) => Promise<DeriveThemeState>>(() =>
      Promise.resolve(REFUSED),
    );
    render(host({ deriveTheme }));

    await handOff();

    expect(await screen.findByTestId("qcms-appearance-drawer")).toBeTruthy();
    await waitFor(() => {
      expect(deriveTheme).toHaveBeenCalledWith("https://brand.example/");
    });
  });

  it("still opens the drawer with the flag off, and fetches nothing", async () => {
    const deriveTheme = vi.fn<(url: string) => Promise<DeriveThemeState>>(() =>
      Promise.resolve(REFUSED),
    );
    render(host({ deriveEnabled: false, deriveTheme }));

    await handOff();

    expect(await screen.findByTestId("qcms-appearance-drawer")).toBeTruthy();
    expect(screen.queryByTestId("qcms-appearance-derive-url")).toBeNull();
    expect(deriveTheme).not.toHaveBeenCalled();
  });
});
