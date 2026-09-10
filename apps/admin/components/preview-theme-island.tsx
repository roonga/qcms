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
 * `@roonga/qcms-ui`'s `theme.css` is anchored on `:is(:root, [data-qcms-theme-scope])`, so an
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
 * This is a known limitation. Fixing it requires either adding `react-aria` as a direct
 * dependency for `UNSAFE_PortalProvider`, or changing `@roonga/qcms-ui` to expose a portal
 * container through `PopoverContext`'s `UNSTABLE_portalContainer`.
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
 * restructuring of any of the three. Phase 4 custom themes can extend
 * `PREVIEW_THEMES` without changing this component's shape.
 *
 * ## The respondent frame, on the two screens whose POC draws one (issue 668)
 *
 * `plan/admin-shell-poc/preview-versions-poc.html` renders the draft preview and the
 * stored version inside a `.respondent-frame`: a 640px bordered, rounded, shadowed inset
 * with a bar above it reading "Respondent view". Its comment is explicit that the width is
 * chosen so the boundary reads "as a device-like inset rather than as 'the page just got
 * narrower here'", which is what the app had after issue 657 gave the screens the width
 * and not the element.
 *
 * It is optional and opt-in because it is drawn on two of the three surfaces and not the
 * third: `question-editor-poc.html` draws its preview as an ordinary card, so
 * `components/questions/question-preview.tsx` passes no label and gets the unframed island
 * it has always had. The frame goes AROUND the carrier rather than inside it, so its bar
 * sits outside `data-qcms-theme-scope` and is painted in this app's own tokens - it is the
 * admin labelling the inset, not something a respondent is ever shown.
 */
export function PreviewThemeIsland({
  defaultTheme,
  frameLabel,
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
  /**
   * The frame's bar text, and the switch that draws the frame at all.
   *
   * A localized string from the caller rather than a boolean, because the two framed
   * screens say different things on it - "Respondent view" on the draft preview,
   * "Respondent view, as stored at publish" on the version - and the difference is the
   * point: the second promises that what is inside is what a respondent SAW, not what one
   * would see now. Absent, no frame is drawn.
   */
  readonly frameLabel?: string;
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
      <Frame label={frameLabel}>
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
      </Frame>
    </div>
  );
}

/**
 * The drawn inset around the carrier, or nothing at all.
 *
 * A fragment rather than an unstyled wrapper when there is no label: an extra `<div>` in
 * the unframed case would be a box between the island's flex column and the carrier, and
 * the carrier's own `container-type: inline-size` makes any such box a layout context the
 * preview would then be sized against.
 *
 * The bar is a `<p>` rather than a heading: it labels the box it sits on and is not a
 * section of the page's outline. Both framed screens already have their own heading above
 * it, and `headingLevelOffset` exists on both renderers precisely because a second outline
 * inside the frame was a real defect once (issue #537).
 */
function Frame({
  label,
  children,
}: {
  // `string | undefined` rather than an optional key: `exactOptionalPropertyTypes` makes
  // those two different types, and what this receives is a prop that may be absent.
  readonly label: string | undefined;
  readonly children: ReactNode;
}) {
  if (label === undefined) return <>{children}</>;
  return (
    <div className="qcms-respondent-frame" data-testid="qcms-respondent-frame">
      <p className="qcms-respondent-frame__bar">{label}</p>
      {children}
    </div>
  );
}
