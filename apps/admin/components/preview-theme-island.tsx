"use client";

import { useState, type ReactNode } from "react";

import { Select } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import {
  DEFAULT_PREVIEW_MODE,
  PREVIEW_MODES,
  PREVIEW_THEMES,
  parsePreviewMode,
  parsePreviewTheme,
  type PreviewMode,
  type PreviewTheme,
} from "@/lib/preview-theme";

/**
 * The preview theme island (task 058, Code Owner direction 2026-08-01).
 *
 * One container that carries the respondent token set, and a pair of controls above it
 * that change which one. Everything a respondent would see is drawn inside the
 * container; the authoring app around it keeps its own Cobalt theme and the operator's
 * own colour mode, and neither side moves the other.
 *
 * ## How the scoping works, and why nothing here writes a colour
 *
 * `data-qcms-theme-scope` is ADR-38's carrier, delivered by task 060: every block in
 * `@qcms/ui`'s `theme.css` is anchored on `:is(:root, [data-qcms-theme-scope])`, so an
 * element wearing the attribute re-declares the whole portal token set on itself,
 * geometry included. `theme-components.css` is a descendant of the bare attribute, so
 * the portal's control treatment - and its high-contrast scaffold - applies inside this
 * container and nowhere else in the app. The theme is then a `data-theme` attribute and
 * the mode a class on the same element, exactly as the portal stamps them on `<html>`.
 *
 * So this component selects a theme; it does not define one. There is no token map
 * here, no palette, and no copy of a single value - which is also the only shape that
 * builds, since `scripts/check-admin-theme.mjs` fails on any colour literal under
 * `components/`.
 *
 * ## The one thing the carrier does not carry: portalled overlays
 *
 * **`Select`, `DatePicker`'s calendar and `Menu` render their popover through a React
 * portal attached to `document.body`, which is outside this container.** A portalled
 * element is not a DOM descendant of the carrier, so no selector - and no value of
 * `data-qcms-theme-scope` - can reach it: it inherits the document root's tokens and
 * therefore renders in the authoring app's Cobalt chrome rather than in the previewed
 * theme. Every `date` question reaches one (the calendar), and a `singleChoice`
 * question above seven options does too (the kit renders those as a `Select`).
 *
 * The *field* stays correct - the trigger button, the label, the description, the error
 * and the committed value are all real descendants and wear the previewed theme. It is
 * the transient overlay, open only while the author is choosing, that does not.
 *
 * This is a known and accepted limitation rather than a defect, and both fixes for it
 * are fenced by constraints task 058 may not cross alone (its amendment of 2026-08-14
 * records the ruling): `UNSAFE_PortalProvider` lives in `react-aria`, which is a
 * transitive dependency here and so a new dependency under the CONTRIBUTING policy, and
 * `PopoverContext`'s `UNSTABLE_portalContainer` needs a `@qcms/ui` change, which this
 * task's exit criterion 8 fences. `docs/gates/058/README.md` states it in an operator's
 * terms and the gate set includes a shot of an open overlay so the appearance was ruled
 * on rather than discovered.
 *
 * ## Ephemeral by design
 *
 * No cookie, no `localStorage`, no server round trip. The selection lives in this
 * component and dies with it, so every page load starts at the deployment's configured
 * theme in light mode. That is deliberate (the task's "Out of scope" names persistence
 * explicitly): the starting point an author must be able to trust is *what this
 * deployment serves*, and a remembered exploration would quietly replace it.
 *
 * ## The seam
 *
 * This component owns the `qcms-preview-surface` container that task 034 built, so all
 * three preview surfaces - the question preview, the draft preview and the published
 * version view - mount the same island by rendering their step inside it, with no
 * restructuring of any of the three. Task 049's custom themes join by extending
 * `PREVIEW_THEMES`; nothing here changes shape for them.
 */
export function PreviewThemeIsland({
  defaultTheme,
  children,
}: {
  /**
   * The deployment's configured portal theme, read on the server by
   * `previewPortalTheme()` and passed down by the page.
   *
   * It is the initial state rather than a fallback: the island is portal-themed from
   * its first paint and never renders in the authoring app's own styling, not by
   * default and not while something loads.
   */
  readonly defaultTheme: PreviewTheme;
  readonly children: ReactNode;
}) {
  const [theme, setTheme] = useState<PreviewTheme>(defaultTheme);
  const [mode, setMode] = useState<PreviewMode>(DEFAULT_PREVIEW_MODE);

  return (
    <div className="qcms-preview-island" data-testid="qcms-preview-island">
      <div className="qcms-preview-switcher" data-testid="qcms-preview-switcher">
        <Select
          label={t("preview.island.theme")}
          value={theme}
          items={PREVIEW_THEMES.map((key) => ({
            label: t(`preview.island.theme.${key}`),
            value: key,
          }))}
          onChange={(next) => {
            // Re-parsed rather than cast. The control can only emit one of the values it
            // was given, so this never falls back in practice - but the parse is what
            // keeps the type honest at the boundary instead of asserting it away.
            setTheme(parsePreviewTheme(next) ?? defaultTheme);
          }}
        />
        <Select
          label={t("preview.island.mode")}
          value={mode}
          items={PREVIEW_MODES.map((key) => ({
            label: t(`preview.island.mode.${key}`),
            value: key,
          }))}
          onChange={(next) => {
            setMode(parsePreviewMode(next) ?? DEFAULT_PREVIEW_MODE);
          }}
        />
      </div>
      {/*
        The carrier. `qcms-preview-surface` is 034's styling boundary and the class list
        is unchanged from what that task landed; the three attributes are what 058 adds.
        `data-qcms-theme-scope` is written as an empty-string attribute because that is
        what the sheets match on - `[data-qcms-theme-scope]`, presence, never a value.
      */}
      <div
        className={`qcms-preview qcms-preview-surface ${mode}`}
        data-testid="qcms-preview-surface"
        data-qcms-theme-scope=""
        data-theme={theme}
      >
        {children}
      </div>
    </div>
  );
}
