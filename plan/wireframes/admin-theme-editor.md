# Wireframe - Admin theme editor

**Status:** Draft (PM/PO seat, 2026-08-08) - not signed off · **Consumed by:** 049 · **Renders:** nothing today - no theme API slice, no config-store table exists (see Interactions) · **Depends on:** 031 (shell), 051/052/053 (token contract, font registry, respondent controls), **060** (ADR-38 scope carrier - the preview region cannot exist without it)

> **Read this before building.** Four things in 049's task file do not match what 051-053 shipped, and this wireframe draws what exists rather than what the task file assumes.
> 1. **A theme is colour only.** `data-theme` varies the 36 `--color-*` tokens; radius, density and font are *orthogonal deployment axes* (`QCMS_PORTAL_CORNERS`, `QCMS_PORTAL_DENSITY`, `QCMS_PORTAL_FONT`), not properties of a named theme. "Grouped token editing per the four-group contract" therefore edits one group plus three deployment settings that live beside the theme, not inside it.
> 2. **The type scale is not editable.** `--type-*` are WCAG 1.4.12 floors and `theme-tokens.test.ts` fails any block that lowers one. The typography group offers the default font from the registry, nothing else.
> 3. **Spacing is the respondent's, not the operator's.** `--space-*` moves only with density, which ADR-30 gives to the respondent. Shown read-only.
> 4. **There is no persistence.** Theme selection is `process.env` read at request time. Custom themes need a table, a migration, an API slice, OpenAPI paths, and a way for the portal to serve CSS custom properties that are not in the compiled `theme.css`. That is API work 049 does not scope.

## ASCII sketch

```
┌─ Settings / Theme ─────────────────────────────────[Save as…]─┐
│ start from [Slate ▾]        editing: "Acme Blue" (custom)     │
│ ┌─ tokens ─────────────────┐ ┌─ preview ───────────────────┐  │
│ │ ▾ Colour            (36) │ │ mode ( Light | Dark | HC )  │  │
│ │   primary   [#0f766e] ▪  │ │ ┌─────────────────────────┐ │  │
│ │     on primary   7.1 ✓   │ │ │ Step 2 of 4             │ │  │
│ │   text      [#0f172a] ▪  │ │ │ Any at-fault accident?  │ │  │
│ │     on background 4.2 ✗  │ │ │ ( ) Yes   ( ) No        │ │  │
│ │ ▸ Typography    (font)   │ │ │ [Continue]              │ │  │
│ │ ▸ Spacing  (read-only)   │ │ └─────────────────────────┘ │  │
│ │ ▸ Corners                │ └─────────────────────────────┘  │
│ └──────────────────────────┘ ⚠ 1 pair below AA - save blocked │
└───────────────────────────────────────────────────────────────┘
```

## Regions (normative)

- **header**: `breadcrumb` (Settings / Theme) · start-from `select` (4 predefined + every saved custom; selecting a predefined theme **forks** it into an unsaved draft, never edits it) · editing indicator (`text`: theme name + `tag` predefined/custom/unsaved) · "Save as…" `button` (primary) · "Delete" `button` (custom only, opens confirm `dialog`).
- **token panel** - four `accordion` sections, one per contract group:
  - **Colour** - the 36 `--color-*` tokens grouped by role (accent triads, status triads, neutrals, focus/overlay). Each row: token name (`text`, monospace) · hex `text-field` · a non-interactive swatch. **Colour picker `[upstream gap]`** - the a2ra registry has no colour input or swatch control, so entry is typed hex validated inline. Cost, stated so the Code Owner can accept or reject it: no visual picking, no eyedropper, no palette wheel, no alpha; an operator picks colours elsewhere and pastes them. Raise as a cross-repo issue per ADR-22 before dispatch; do not substitute a hand-rolled picker.
  - **Typography** - default font `select`, rendered from `packages/ui/src/font-registry.ts` grouped exactly as the registry groups it. The `--type-*` scale is displayed read-only with a `tooltip` naming WCAG 1.4.12; the manifest itself is out of scope (049).
  - **Spacing** - read-only display of the five `--space-*` tokens at Comfortable, with `text` stating that density is a respondent control (ADR-30) and not part of a theme.
  - **Corners** - `radio` group over the four shipped presets (Sharp / Subtle / Rounded / Pill). Radius is a preset axis, not four free numbers; there is no per-token radius entry.
- **contrast readouts**: every semantic pair the token contract fences carries an inline `tag` (ratio + pass/fail) directly beneath its row - 11 text pairs at 4.5 (7 in HC) and 5 UI pairs at 3, the same sets `theme-tokens.test.ts` enforces. A failing pair also raises an `alert` in the footer summarising the count and linking to each offender.
- **preview**: `card` holding a representative portal step (progress line, one `radio` question, one `text-field`, Continue `button`, one error state), rendered by the shared `@roonga/qcms-ui` renderer - never a hand-drawn mock. Mode switch `radio` (Light / Dark / High contrast) so all three are inspectable. **Scoping is load-bearing:** admin's Cobalt sheet re-declares the same token names on `:root` later in source order, so an unscoped preview silently renders admin colours *and* admin geometry. The preview element carries `data-qcms-theme-scope` per ADR-38, which task **060** delivers. Until 060 lands there is no correct way to build this region.
- **HC notice**: informational `alert`, always visible - a custom theme contributes only its AAA-deep accent to High contrast; the HC layer is theme-agnostic and is not editable here (ADR-30).
- **save `dialog`**: name `text-field` (unique per deployment) · confirm `button`. Blocked while any pair fails; the dialog states the blocking count rather than failing on submit.

## States (normative)

no custom themes yet (predefined only) · forked-unsaved draft (dirty) · contrast failure blocking save · save dialog open · saved and selected as the deployment theme · custom theme reopened for edit · delete confirm · duplicate-name reject · save failed (API error `alert`).

**Reachability, stated plainly:** only the first two are reachable today. Every state involving a *saved* custom theme needs a seed fixture that cannot exist until the config-store table exists, so the static-render screenshot gate cannot cover them at dispatch time. Either the API work lands first or the gate covers a reduced state set by explicit agreement.

## Interactions

- Fork a predefined theme -> **no call** (client-side copy of the resolved token block) -> editor enters unsaved-draft state.
- Edit any colour -> **no call** -> preview restyles and every affected contrast `tag` recomputes in the browser. The computation must match `theme-tokens.test.ts` exactly; today its `luminance`/`contrast` helpers are test-private (and `luminance` calls `expect()` internally), so 049 must extract a runtime module from `@roonga/qcms-ui` and have the test consume it, or the editor and the gate can disagree.
- Save named theme -> `POST /admin/themes` · edit -> `PUT /admin/themes/:id` · delete -> `DELETE /admin/themes/:id` · select for deployment -> `PUT /admin/settings/theme`. **None of these routes exists.** There is no theme slice in `apps/api/src/features/`, no themes or settings table in `packages/db/src/schema/`, and no theme path in `docs/openapi/admin.json`. Contrast this with the sibling wireframes, every one of which renders a landed slice.
- Portal consumption of a saved theme is also unbuilt: `PORTAL_THEMES` is a closed four-value union compiled into `apps/portal/lib/server/theme.ts`, and each theme's tokens are static blocks in `theme.css`. A custom theme reaches a respondent only if the portal emits its tokens at runtime (an SSR inline custom-property block on `<html>`), which is a new mechanism, not a config value.
- Save feedback uses an inline `alert`; the toast gap on the README's running list is still open.

## A11y notes

- Contrast results are text plus ratio, never colour alone; a failing row is `aria-describedby`-linked to its explanation and the footer `alert` count is announced `aria-live="polite"` on change.
- The preview is a labelled region marked `aria-hidden="false"` but explicitly described as a preview, and its interactive controls are inert - a respondent control inside an authoring screen must not be tabbable, or the editor grows a second focus order.
- Mode switch is `radio`, so all three modes are keyboard-reachable without leaving the screen; the axe gate runs the editor in all three admin modes (055) **and** with the preview set to each of the three portal modes.
- Accordion groups are keyboard-operable and remember expansion across mode switches. The save dialog traps focus and returns it to the Save button; a blocked save moves focus to the first failing token row rather than to the dialog.
- Hex entry is a plain `text-field`: label, inline format error, no colour-only feedback. This is the accessibility floor the `[upstream gap]` costs us and it is the reason the gap is worth filing rather than working around.
