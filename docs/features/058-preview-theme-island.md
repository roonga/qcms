# 058 - Preview theme island: respondent theme and mode switching inside the admin preview

**Stage:** 8a · **Apps/packages:** `apps/admin` (preview surface), consuming `@qcms/ui`'s existing theme assets read-only · **Depends on:** 060 (the scope carrier this island mounts on - ADR-38; without it the token sheets match only `:root` and nothing here is expressible), 032 (the preview exists; its interactivity round from PR #228 included), 034 (builds the preview styling seam this island mounts on), 035 (not technical - editor enrichments run behind the response chain per the Code Owner's 2026-08-01 flow-first aim; recorded here because `Depends on` is the mechanism selection reads for "runs after").
**References:** ADR-30 + tasks 051/052/053 (the portal token contract this reuses: predefined themes as CSS custom-property sets, mode as a class layer, one `.hc` layer) · ADR-27 (i18n) · `apps/admin/components/questions/question-preview.tsx` (the island) · task 049 (admin theme editor - future custom themes join this switcher; loose coupling, no dependency) · task 034 (builds the preview container styling seam this island mounts on, and runs first) · Code Owner direction 2026-08-01 ("the preview should allow island theme switch").

## Context

The preview shows a question through the real respondent renderer, but always in one visual context. Authors need to see their content under the respondent themes and modes a deployment can serve - especially high contrast, where label/option treatments change materially. The switch must be an **island**: it themes the preview container only, while the admin chrome around it stays on the app's own Cobalt theme and the operator's own mode, unaffected.

**The island is portal-themed from its first paint (Code Owner addition, 2026-08-01: "the preview should use the portal theme").** The preview never renders in the admin's Cobalt styling - not by default, not as a fallback. Its default is the **deployment's configured portal theme**: the admin reads the same deployment configuration value the portal reads for its managed-theme selection (composition supplies that knob to both apps; `apps/admin/.env.example` documents it), falling back to the token contract's base theme when unset. The switcher then lets the author explore the other themes and modes from that starting point.

## Deliverables

- **Scoped theme application:** the preview container carries `data-qcms-theme-scope` (ADR-38, delivered by 060) plus the selected theme attribute and mode class, so the 051 token sheets and the portal treatment sheet resolve against the island rather than the document root. The admin imports `@qcms/ui/theme-components.css`, which 060 re-anchors on the bare attribute so it applies inside the island and nowhere else. The admin's own stylesheet and mode control are untouched; nothing leaks in either direction (the island's tokens do not inherit admin Cobalt values for renderer-consumed variables).
- **Switcher UI** above the preview: two compact labeled controls (theme, mode) in the design system's control language, **defaulting to the deployment's configured portal theme** (same config value the portal reads, supplied by composition; base theme when unset) in light mode, **ephemeral** - no persistence, resets per page load. Labels through the i18n catalog (ADR-27).
- **Reusable shape:** the island (switcher + scoping) mounts on the preview container styling seam 034 builds, and applies to both the question preview and 034's form-level preview without either surface being restructured; 049's custom themes extend the theme list later without structural change (note the seam in the component doc).
- **Read-only consumption:** theme definitions come from `@qcms/ui`'s shipped assets; no copy of token values into the admin, no new API surface.

## Amendment, 2026-08-14: the portalled-overlay limitation is a deliverable

Added on the Code Owner's ruling that 058 runs next, so that it does not park a second time at a fence it cannot clear.

**What the task must produce, in addition to the criteria below:**

1. The limitation is **documented in the component**, saying which controls portal out of the carrier and therefore render in admin chrome tokens rather than the previewed theme.
2. It is **documented in `docs/gates/058/README.md`**, in the operator's terms rather than the implementer's.
3. **One gate screenshot deliberately shows an open overlay** (a `Select` or a `DatePicker` calendar) against a switched island, so the Code Owner rules on the appearance **at** the gate rather than discovering it afterwards.

**Why it is accepted rather than solved.** Two fixes exist and both are fenced by constraints this task may not cross alone:

- `UNSAFE_PortalProvider` from `react-aria/PortalProvider` works (it reads `useUNSAFE_PortalContext()` and portals to `getContainer()`), but `react-aria` is a **transitive** dependency here, so adopting it is a new dependency under the CONTRIBUTING policy.
- RAC's `PopoverContext` with `UNSTABLE_portalContainer` exists on 1.20.0, but the admin may not import `react-aria-components` (`apps/admin/lib/questions/renderer-surface.test.ts`), so it needs a **`@qcms/ui`** change, which exit criterion 8 fences.

RAC does not re-export the provider from its index, so there is no third route. **If a session wants either fix, it stops and surfaces it** rather than taking it, exactly as the criterion-8 fence worked in the original run.

**One correction carried in from #405 and #442.** Both stated that a Tailwind `@theme` variable is resolved at build time and so cannot be matched by a selector. That is wrong, verified by compiling the pinned `tailwindcss@4.3.3`: the `@theme` **block** is unscopable, but the **variables it emits are ordinary inherited custom properties resolved per element at render time**. So the type-scale half of #405 is a five-line subtree override on the carrier, not a blocker. Note also that `--type-*` has no consumer inside an island by itself: what applies the floors is `apps/portal/app/globals.css:71-82`, the portal **app's** stylesheet, which the admin does not import, so the carrier block must restate them or the island renders at admin spacing.

## Exit criteria

1. **The island is portal-themed at first paint:** with the deployment theme knob set, the untouched preview renders that theme's known token values (asserted computed-style), and in no state does an island control **rendered inside the scope carrier** resolve an admin-Cobalt token value; with the knob unset, the base theme renders. **Portalled overlays are excluded from this clause and are covered by the 2026-08-14 amendment above, "the portalled-overlay limitation is a deliverable"** (do not read this as pointing at exit criterion 4, which is about interactivity): `Select`, `DatePicker`'s calendar and `Menu` each render a react-aria `Popover` into a portal outside the carrier, so they cannot inherit it by any selector. Every `date` question reaches one, and `singleChoice` above seven options does too. Read literally, the original clause was unsatisfiable the moment a dropdown opened. The knob is documented in `apps/admin/.env.example` and named identically to the portal's.
2. Switching theme and mode restyles the island only: an e2e asserts computed styles change on a control inside the island while the admin topbar's computed background/color are byte-identical before and after, in both directions (admin mode switch leaves the island's selection alone too).
3. All 051 predefined themes and all three modes selectable; HC inside the island renders the portal HC layer (assert a known HC token value on an island control).
4. Interactivity from 032's preview round still works under a switched theme (tick a checkbox while the island is in dark harbor, for instance).
5. axe green with the island in HC while the admin chrome is in light, and vice versa (the mixed states are the novel a11y surface).
6. Switcher labels localized; keyboard operable; visible focus (standard checks).
7. Screenshot set under `docs/gates/058/`: the island in at least three theme/mode combinations against unchanged admin chrome, at 390 and 1280 (human gate).
8. `pnpm verify` + `pnpm verify:browser` green; no new dependencies; **no `@qcms/ui` source changes beyond what 060 already landed** (consumption only). The original form of this criterion said no `@qcms/ui` changes at all and told the session to stop and surface it if scoping required restructuring the sheet. It did, the session stopped, and the Code Owner ruled on 2026-08-07: ADR-38, implemented by 060. **The fence worked and is retained in this weaker form** - if the island still cannot be expressed against 060's carrier, stop and surface it again rather than widening the contract here.

## Out of scope (binding)

Persisting the selection (per-operator or otherwise); custom themes (049 extends the list when it lands); font and density switching in the island (respondent-side controls - revisit only if author feedback asks); theming any admin surface outside the preview container; changes to `@qcms/ui` or the portal.

## Findings that bind this task whatever the scoping approach

Established by the investigation behind ADR-38 (`plan/058-theme-scoping-options.md`), verified against the tree. Recorded here so they are not rediscovered mid-implementation.

1. **The question preview has no seam.** `apps/admin/components/questions/question-preview.tsx` uses only `.qcms-preview`; the `.qcms-preview-surface` boundary exists on the two form-level surfaces alone. The "reusable shape" deliverable therefore requires adding the seam there, which trips `apps/admin/lib/questions/renderer-surface.test.ts`'s assertion that the marker appears **exactly twice** per module, and its two-module `RENDERING_MODULES` list.
2. **That test's negative guard must be inverted, not deleted.** It currently asserts the preview modules contain none of `qcms-app-mode`, `QCMS_PORTAL_THEME`, `portalTheme`, `setTheme`. This task has to relax it. **Replace it with the inverse assertion** - that the island sets the scope attribute and the admin chrome does not - because a deleted guard is a check that looks at nothing and passes exactly as loudly as a real one.
3. **An admin-side JavaScript map of token values is not implementable**, independent of this task's own rule against copying token values: `scripts/check-admin-theme.mjs` (in `check:all`) fails the build on any hex, `rgb()`/`oklch()` literal, or Tailwind palette utility anywhere under `apps/admin/app` or `apps/admin/components` outside `apps/admin/app/theme.css`. Theme values reach the island through the stylesheets or not at all.
