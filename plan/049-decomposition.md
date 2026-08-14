# Task 049 decomposition: the four sub-tasks, drafted to paste

**For:** the Code Owner. **From:** the PM/PO seat, 2026-08-13.
**Reads with:** `plan/049-replan.md` (2026-08-08), which established that 049 is an arc rather than a screen and recommended **Path 1** (descope). This document is the **Path 2** artifact that paper promised and did not draft: if named custom themes are genuinely launch tier, this is what 049 becomes.

**It does not re-argue the Path decision.** The recommendation in `plan/049-replan.md:106-114` still stands and the deciding argument has not weakened: Path 2's central deliverable cannot be gated, because every state involving a saved custom theme is unreachable in fixtures until 049a and 049c both land, so 049d's screenshot gate would be signed against states the feature's point never reaches. What this document adds is a **costed, paste-ready Path 2**, so the choice is made against two real options rather than one option and a shrug.

Everything below was verified against `main` (14a81ff). The three findings that shape the split:

- `grep -rni theme apps/api/src` -> **0 hits**; `grep -rni theme packages/db/src` -> **0 hits**. There is no theme slice, no config-store table, no OpenAPI path. The latest migration is `packages/db/migrations/0016_outbox_payload_retention.sql`.
- Task **056** moved better-auth into the API and removed the admin's database handle, so nothing here may reach Postgres from `apps/admin`. Every read and write goes API slice -> admin BFF.
- Task **060** landed (PR #418), so the editor's live preview has a carrier to mount on. `plan/wireframes/admin-theme-editor.md` is drafted against the shipped contract and is the design input; it is **unsigned** and its sign-off is a prerequisite of 049d, not of the others.

---

## Why four, and not three or five

**Not three.** The obvious merge is 049a into 049c (persistence plus emission as one "make custom themes real" task). It should not be merged: 049c reopens the SSR no-flash guarantee that 053 proved by first-frame sampling, and that is the single riskiest thing in the arc. Bundling it with a migration and four API routes means a rollback of the risky half drags the safe half with it, and it makes the PR too wide for a reviewer to hold the no-flash argument in view.

**Not five.** The tempting fifth split is "editor screen" versus "theme management (list, rename, delete, select)". They share one screen, one BFF surface and one screenshot gate; splitting them would produce a second task whose whole diff is three list rows and a confirm dialog, and would double the human-gate count for one surface. Kept together as 049d.

**049b is deliberately independent of the other three.** It is the only piece that is useful under **both** paths, and the only one that can be dispatched before the Path decision is made. That is its main virtue and it is why it is numbered second rather than last.

---

## Ledger rows (the ledger's own style, stage 8a)

| # | Task | Stage | Status |
|---|---|---|---|
| 049a | Theme store: `custom_themes` table + migration, query helpers, API slice, OpenAPI paths, admin BFF routes (ADR-30 launch clause; no UI) | 8a | todo |
| 049b | WCAG contrast module: a runtime-importable `@qcms/ui` export replacing the test-private helpers, over the pairs and targets 051 fences | 8a | todo |
| 049c | Portal runtime theme emission: a stored custom theme reaches a respondent as an SSR token block on the carrier, no-flash guarantee re-proven (053 EC 5) | 8a | todo |
| 049d | Admin theme editor screen: fork, edit colour, inline contrast verdicts, live scoped preview, save/rename/delete a named theme (folds #26; UI screenshot gate) | 8a | todo |

Replace the existing `049` row with these four. Keep the retired `049` number out of the table rather than leaving it as a parent: the ledger has no parent rows, and 047 set the precedent by recording its decomposition in its own `done` cell.

---

## 049a - Theme store

```
# 049a - Theme store: persistence and the API surface for named custom themes

**Stage:** 8a - **Apps/packages:** `@qcms/db` (schema, migration, query helpers), `apps/api` (one slice), `apps/admin` (BFF routes only, no screen) - **Depends on:** 013/014 (schema and query-helper conventions), 017 (composition root), 022 (the authoring-slice precedent this follows), 031 (admin shell), 056 (the admin has no database handle: every read and write crosses the API).
**References:** ADR-30 as amended 2026-07-25 (launch tier) - ADR-20 (single-tenant: one theme library per deployment, never per org) - ADR-18 (why a theme is NOT form-grade content) - `docs/DOMAIN_SCHEMA.md` - `docs/openapi/admin.json` - `plan/wireframes/admin-theme-editor.md` (the shapes the editor will read and write) - `plan/049-decomposition.md`.

## Context

ADR-30 says a saved theme is **mutable operator config, not form-grade immutable content**, so the three non-negotiables are untouched by everything here. What does not exist is anywhere to put it: `grep -rni theme apps/api/src` and the same over `packages/db/src` both return zero. Theme selection today is `process.env`, read at SSR in `apps/portal/lib/server/theme.ts`.

This task builds the store and the surface over it, and **ships no UI at all**. That is deliberate: it is the half of the arc that has no screenshot gate, so it can land and be reviewed on its tests alone while the editor's wireframe is still being signed.

## Deliverables

- **`custom_themes` table + migration** (`packages/db/src/schema/themes.ts`, next migration number after `0016`): id (branded per R6; **the prefix is an open decision, not a drafting detail** - `packages/core/src/ids.ts:7-9` states the set `q_ frm_ stp_ opt_ rul_ ses_ lnk_` is "settled project-wide" and `CLAUDE.md` repeats it, so a new one such as `thm_` needs the Code Owner's approval and an edit to both places before 049a is dispatched. R6 also makes it irreversible in practice: a prefix, once issued, is never reused with a different meaning), deployment-unique name, the `--color-*` map, the base theme it was forked from, `createdAt`/`updatedAt`. Mutable: UPDATE and DELETE are both allowed and this table is outside the R3 append-only fence, which `packages/db/src/schema/append-only.test.ts` must continue to state rather than merely not cover.
- **Query helpers** in `packages/db/src/queries/themes.ts`, re-exported from `queries/index.ts` **and** added to `import-surface.test.ts`'s allowlist (the 3-place edit).
- **One API slice** under the admin surface: list, create, rename, replace token map, delete, and read-one. Fetch-pure handlers, vertical slice, R5 shape.
- **OpenAPI** paths in `docs/openapi/admin.json`, generated and asserted the way the existing admin paths are.
- **Admin BFF routes** proxying exactly those operations, and nothing else. No screen, no component, no navigation entry.
- **Validation at the boundary**: a stored theme must carry the complete `--color-*` set the token contract fences (the same names `packages/ui/src/theme-tokens.test.ts` reads), rejected with typed errors when it does not. A name is unique per deployment and the duplicate is a typed reject, not a 500.

## Exit criteria

1. Migration applies forward on a clean database and the schema-drift check is green; a `withTestDb` integration test covers create, read, rename, replace, delete and the duplicate-name reject.
2. The slice's contract tests cover every operation including both reject shapes, and the OpenAPI document matches the handlers (existing assertion mechanism, not a new one).
3. The admin's import-surface tests still pass unchanged: no `@qcms/db` import appears anywhere under `apps/admin` (056's property, restated here because this is the first task since 056 that would be tempted).
4. A theme row's mutability is asserted, not assumed: a test shows UPDATE and DELETE succeeding on `custom_themes` while the answer-ledger guards remain in force on `answers`.
5. Nothing in `apps/portal` reads this table yet (049c owns that), and nothing renders it (049d owns that) - asserted by grep-style surface tests, in the house pattern.
6. `pnpm verify` green with `turbo run test --force` reporting `0 cached`; changeset for `@qcms/db`.

## Out of scope (binding)

Any UI. Portal consumption (049c). Contrast validation (049b supplies the module; the *enforcement* lives in 049d, where a human can see the message). Versioning or immutability for themes - ADR-30 settles this and reopening it is an ADR, not a task. Per-form or per-org themes (ADR-20). Font, density, corner or brand-mark storage: those are orthogonal deployment axes, not properties of a theme.
```

**Screenshot gate:** no. **ADR-30 clause satisfied:** "save it as a named custom theme" (the persistence half), and "themes remain mutable operator config".

---

## 049b - WCAG contrast module

```
# 049b - A runtime-importable WCAG contrast module in `@qcms/ui`

**Stage:** 8a - **Apps/packages:** `@qcms/ui` (one new export) - **Depends on:** 051 (the pairs, the targets and the ratios this must reproduce).
**References:** ADR-30 (HC contributes only the AAA-deep accent) - `packages/ui/src/theme-tokens.test.ts` (the current, test-private implementation and the fenced pair set) - `docs/theming.md` (the normative pair table) - WCAG 2.2 SC 1.4.3 / 1.4.11 - `plan/049-decomposition.md`.

## Context

The project computes WCAG contrast in two places and can import neither. `packages/ui/src/theme-tokens.test.ts` holds the real implementation, but its helpers call `expect()` internally, so they are structurally unusable outside vitest; `apps/admin/e2e/appearance.pw.ts` carries a second copy for the browser leg. Any surface that wants to tell an operator "this pair is 4.2:1, below AA" has to write a third.

This task extracts one implementation, ships it as a public `@qcms/ui` export, and makes both existing call sites consume it. It ships **no UI** and changes **no ratio**.

## Deliverables

- **`packages/ui/src/contrast.ts`**, exported from the package index: a pure relative-luminance and contrast-ratio pair over the colour notations the token sheets actually use, plus the fenced pair set and its targets as data (11 text pairs at 4.5, 7 of them at 7 in high contrast, 5 UI pairs at 3 - the same sets the token test enforces today, taken from `docs/theming.md`, not re-derived).
- **`theme-tokens.test.ts` consumes it** instead of its private helpers, and the assertion-inside-a-helper shape is removed rather than wrapped.
- **`apps/admin/e2e/appearance.pw.ts`'s copy is deleted** and replaced by the import.
- **Changeset** for `@qcms/ui`: this is a public-surface addition.

## Exit criteria

1. **The extraction is provably behaviour-preserving:** all 12 theme x mode combinations still compute, and every ratio is byte-identical to the currently committed values. A single changed digit is a failure, not a rounding note.
2. **The module is shown capable of going red.** A test feeds it a deliberately failing pair and asserts the verdict is `fail` with the ratio reported - the same discipline 060 exit criterion 3 established, because a contrast function that always says pass is the exact defect this module exists to prevent downstream.
3. The module is importable from a non-test context: an assertion imports it from the package entry point and calls it with no vitest globals in scope.
4. No second implementation survives anywhere in the workspace (grep-style surface assertion over `packages/` and `apps/`).
5. `pnpm verify` green with `turbo run test --force` reporting `0 cached`; `pnpm verify:browser` green (the e2e copy moved); changeset present.

## Out of scope (binding)

Any UI, including a read-only checker screen. Colour-space work beyond what the shipped sheets use. Changing a target, a pair, or a ratio - this task moves code, never verdicts. APCA or any non-WCAG model.
```

**Screenshot gate:** no. **ADR-30 clause satisfied:** none directly. It is the enabler for 049d's "WCAG contrast checks inline (AA minimum enforced for the semantic color pairs)".

---

## 049c - Portal runtime theme emission

```
# 049c - A stored custom theme reaches a respondent

**Stage:** 8a - **Apps/packages:** `apps/portal` (SSR emission), `apps/api` (the read the portal BFF makes) - **Depends on:** 049a (there is nothing to emit until themes are stored), 053 (the no-flash guarantee this must not break), 060 (the carrier the emitted block anchors on).
**References:** ADR-30 - ADR-38 (the scope carrier) - task 053 exit criterion 5 (no-flash, proven by first-frame sampling) - `apps/portal/lib/server/theme.ts` (today's env-only resolution) - `apps/portal/app/layout.tsx` (where the carrier and mode class are stamped) - `docs/theming.md` (the adopter override surface this must not out-rank) - `plan/049-decomposition.md`.

## Context

`PORTAL_THEMES` is a closed four-value union compiled into the portal, with each theme's tokens as static blocks in `packages/ui/src/theme.css`. A saved custom theme cannot reach a respondent through any mechanism that exists. This task adds the one that does: the portal resolves the deployment's selected theme, and when it is a custom one, emits its `--color-*` block inline on the carrier during SSR.

**This is the risky task of the arc and it should be reviewed as such.** 053 proved no-flash by sampling the first painted frames, and the property it proved is that the server stamped the root before the first byte rather than a script correcting it afterwards. An inline token block is a new thing in that critical path.

## Deliverables

- **Resolution extends, it does not fork.** `apps/portal/lib/server/theme.ts` resolves either a predefined theme (unchanged path, `data-theme` attribute) or a stored custom theme (id or name), with the same silent fallback to the base theme on an unrecognised value that `docs/operations.md` documents today.
- **SSR emission on the carrier.** A custom theme's tokens are emitted as a single style block anchored on the carrier element the portal already stamps (ADR-38), in the first byte of the document, ahead of any hydration. **Unlayered and no more specific than the sheets it overrides**, so `apps/portal/app/adopter-theme.css` keeps overriding exactly as `docs/theming.md` says it does.
- **The CSP holds.** The emission must satisfy the portal's existing content-security policy without widening it: the nonce mechanism 029 already uses, never a new `style-src` allowance.
- **The mode and HC layers still win.** A custom theme supplies base palette values only; `.dark` and `.hc` continue to resolve by source order exactly as 051 established, and a custom theme contributes only its AAA-deep accent to high contrast (ADR-30).
- **Documentation follows in the same PR** (staleness rule): `docs/theming.md`'s selector-convention section and `docs/operations.md`'s `QCMS_PORTAL_THEME` row both describe a closed value set today.

## Exit criteria

1. **A stored custom theme renders for a respondent, end to end**, in a full-stack test: seeded through 049a's API, selected as the deployment theme, and asserted on rendered computed style in a real browser, including a geometry-adjacent token so a colour-only emission is caught.
2. **No-flash is re-proven, not assumed.** 053's first-frame sampling runs against a custom theme and shows no intermediate paint in the base palette. A pass that only samples after load is not evidence here.
3. **The adopter override still wins.** `adopter-theme.css` overriding a custom theme's token resolves to the adopter's value, asserted in a browser.
4. **High contrast is unaffected by a custom palette** beyond the accent: an assertion shows the HC text and background pair at their fixed AAA values with a custom theme selected.
5. **The CSP is unchanged**: the policy string is compared to the current one and the emitted block still applies.
6. All four predefined themes render byte-identically to today across light/dark/hc - the unchanged path is regression-tested, not eyeballed.
7. `pnpm verify` + `pnpm verify:browser` + `QCMS_PORT_SEAT=<0-9> pnpm up:e2e` green (this crosses a service boundary and touches what the portal reads at boot).

## Out of scope (binding)

Any admin UI. Per-form theming. Respondent-side selection of a custom theme (mode, font and density remain the respondent's; theme remains the deployment's). Emitting anything but the `--color-*` group: corners, font and density are orthogonal deployment axes and stay env-resolved.
```

**Screenshot gate:** no (nothing new is visible to an operator; the respondent-visible change is asserted by computed style, and 053's gate already covers the portal's appearance). **ADR-30 clause satisfied:** "appears in the per-deployment theme selection alongside predefined themes", respondent half.

---

## 049d - Admin theme editor screen

```
# 049d - Admin theme editor: fork a theme, edit colour, save it by name

**Stage:** 8a - **Apps/packages:** `apps/admin` - **Depends on:** 049a (the store), 049b (the contrast module), 049c (a saved theme that reaches nobody is not a feature), 060 (the scope carrier the live preview mounts on), 031 (shell), 051/052/053 (the contract being edited).
**External input required:** `plan/wireframes/admin-theme-editor.md`, **signed off by the Code Owner** before dispatch (042 convention). It is drafted and unsigned today; it is the contract, and if it and this file disagree the wireframe wins and the discrepancy is reported.
**References:** ADR-30 as amended - ADR-22 (single component stack; the colour-picker gap below) - ADR-26 - ADR-27 (i18n) - ADR-38 - folds issue #26 - `plan/049-decomposition.md` - `plan/theme-scope-open-questions.md` (the island's type and overlay behaviour, which this preview inherits from 058's territory).

## Context

The screen ADR-30's amendment asks for. An operator starts from a predefined theme, adjusts its colour tokens, sees an inline AA verdict on every fenced pair, watches a live respondent preview change as they type, and saves the result as a named theme selectable like any predefined one.

**What it edits is narrower than 049's original wording, and the wireframe's preamble is the reason.** `data-theme` varies the 36 `--color-*` tokens and nothing else. `--type-*` are WCAG 1.4.12 floors and `packages/ui/src/theme-tokens.test.ts` fails any block that lowers one. `--space-*` moves only with density, which ADR-30 assigns to the **respondent**, so an operator editing it would override a user's accessibility choice. Radius is four presets. So the four-group contract is presented as **one editable group and three read-only or preset ones**, which the wireframe draws and this task builds.

## Deliverables

- **The editor screen** per the wireframe's normative Regions and States: start-from picker (predefined and saved custom; picking a predefined one **forks** it into an unsaved draft and never edits it), the four grouped sections with only Colour editable, per-pair inline contrast verdicts from 049b, the always-visible high-contrast notice, and the save dialog.
- **Live scoped preview**: a representative portal step rendered by the shared `@qcms/ui` renderer - never a hand-drawn mock - inside a container carrying `data-qcms-theme-scope` (ADR-38), with a mode switch so light, dark and high contrast are all inspectable. The draft's edited tokens apply to that container only; the admin chrome around it stays on Cobalt.
- **Save, rename, delete** over 049a's routes, with the duplicate-name reject rendered inline and actionable.
- **Validation is enforced here, where a human can read it**: an incomplete token set or any fenced pair below its floor blocks save with an inline explanation naming the offending pairs.
- **i18n**: every string through the catalog (ADR-27).
- **Colour entry is typed hex with inline validation**, and the absence of a picker is stated in the UI rather than worked around: see the upstream gap below.

## Exit criteria

1. Create-customize-save-select round trip proven in Playwright **against a real portal render using the saved theme** (this is the criterion 049c exists to make reachable).
2. Contrast floor enforced: a failing pair blocks save with an inline explanation naming it (test), and the verdict comes from 049b's module rather than a local copy (surface assertion).
3. Predefined themes remain immutable; forking is the only edit path (test).
4. The preview is genuinely scoped: an assertion shows a preview control resolving the draft's colour **and** the portal's geometry while the admin topbar's computed background and colour are byte-identical before and after an edit.
5. axe green on the editor in all three modes, including with the preview in high contrast while the chrome is in light.
6. Screenshot set under `docs/gates/049d/`, README naming what to approve, at 390 and 1280 in light/dark/HC: the rest state, a dirty fork, a blocking contrast failure, the save dialog, and a saved custom theme selected (human gate). **Every state in the wireframe's States list must be reachable in the fixtures** - if one is not, stop and surface it rather than shipping a reduced gate quietly.
7. `pnpm verify` + `pnpm verify:browser` green; no new dependencies.

## Out of scope (binding)

Per-form theming. Font-manifest editing (the registry stays config). Editing the HC palette, the type scale or the spacing group. Theme import/export. Multi-tenant theme libraries (ADR-20). A hand-rolled colour picker (ADR-22: raise it upstream, never invent it). Changing which themes ship.
```

**Screenshot gate:** yes, and it is the arc's only one. **ADR-30 clauses satisfied:** "the admin can customize a predefined theme's tokens", "save it as a named custom theme", "appears in the per-deployment theme selection", "predefined themes immutable - customizing one forks it", "AA minimum enforced for the semantic color pairs", "custom themes contribute only the AAA-deep accent to HC mode; the editor communicates this rather than offering HC-palette editing".

---

## Launch-gating: which of these actually gates 038

**Under Path 2 as drafted, 049a, 049c and 049d are all launch-gating and 049b is transitively so.** ADR-30's amended Scope clause puts "the admin UI to customize a theme's tokens and save a named custom theme" at launch tier. 049d is that UI; 049a and 049c are the only things that make its central verb mean anything; 049b is required by 049d exit criterion 2. There is no honest way to build the arc and mark a piece of it non-gating while the clause stands.

**On the live proposal to split out a piece as "built, prioritised, but not launch-gating":** the only sub-task the description genuinely fits is **049b**. It is small, it is independent of the other three, it is useful under both paths, and **nothing in ADR-30's launch clause names it**. It is the one piece where "build it now, decide the Path later" is honest rather than a way of starting an arc before its decision.

The proposal should therefore be taken in this exact form and no other:

- **049b is dispatchable immediately**, before the Path decision, and its ordering-exception row (if the Code Owner wants one) reads **"049b - never gates 038"**, the 041 shape.
- **049a, 049c and 049d are not splittable out.** Marking any of them "never gates 038" while ADR-30's Scope clause stands would be a descope wearing an ordering exception as a disguise. If the intent is to descope, the instrument is the ADR amendment below, not the table.

The honest summary for the Code Owner: **the choice is Path 1 or Path 2, and "Path 2 with a piece marked non-gating" is Path 1 with extra steps.**

---

## Does ADR-30 need an amendment?

**Yes, under either path, and the wording differs.**

**Unconditionally, and independent of the Path decision:** ADR-30 contradicts itself. `docs/PROJECT_GOAL.md:236` (Scope) carries the 2026-07-25 amendment putting the custom-theme editor at launch tier; `docs/PROJECT_GOAL.md:240` (Consequences) still reads "the save-custom-theme admin UI is Phase-4". `apps/portal/lib/server/theme.ts:23` and `:124` inherit the Phase-4 reading into code comments. Whichever path is taken, these three must be made to agree with it in the same change.

### If Path 2 is taken, the amendment is a correction of scope, not of tier

> **Amendment (2026-08-13, from the 049 decomposition).** The launch-tier clause added on 2026-07-25 stands, and two things it assumed did not ship. **First, what a theme varies is colour.** Tasks 051 to 053 delivered `data-theme` as a set of `--color-*` values; the default font, the corner preset, the density and the brand mark shipped as **orthogonal per-deployment axes** beside the theme, not as properties of it, and the `--type-*` and `--space-*` groups are not an operator's to edit at all (the first carries the WCAG 1.4.12 floors, the second moves only with the respondent's own density control). "Grouped token editing per the four-group contract" therefore means one editable group and three read-only or preset ones, which is what the signed wireframe draws. **Second, a saved theme had nowhere to live and no way to reach a respondent**: there is no theme table, no API slice and no runtime emission path, and `PORTAL_THEMES` is a closed union compiled into the portal. Task **049 is therefore replaced by 049a (theme store), 049b (contrast module), 049c (portal runtime emission) and 049d (the editor screen)**; 049b is independent of the launch gate, the other three are not. The **Consequences** paragraph's "the save-custom-theme admin UI is Phase-4" is superseded by the Scope paragraph and is corrected here.

### If Path 1 is taken, the amendment moves the tier back

> **Amendment (2026-08-13, from the 049 decomposition).** The 2026-07-25 promotion of the custom-theme editor to launch tier is **withdrawn**, and the Consequences paragraph's original reading is restored: **named custom themes are Phase 4**. The reason is not effort. Tasks 051 to 053 shipped a theme as a set of `--color-*` values with no store, no API surface and no runtime emission path, so delivering the promoted clause means a database table, an API slice, a new SSR mechanism inside the no-flash guarantee 053 proved by first-frame sampling, and only then a screen - and every state that screen exists for is unreachable in fixtures until the first three land, so its screenshot gate could not be signed against the feature's own purpose at the moment of review. What ships at launch instead is the **`adopter-theme.css` override point this ADR already preserves**, documented as the supported customization path, plus a **read-only AA contrast readout in the admin** over the operator's own palette - the part an operator cannot get anywhere else. Issue #26 stays open against Phase 4 carrying the analysis in `plan/049-replan.md` and `plan/049-decomposition.md`.

---

## Does the ordering-exception table need widening?

**No, and the live proposal to widen "060 before 058" to "060 before 058 and 049d" should be declined, for two reasons.**

**First, that row no longer exists.** `docs/features/README.md:12-16` carries exactly two ordering exceptions today, for 040 and 041. Line 18 records that 042, 043, 044, 045, 055, 056, 059 **and 060** all carried one and are now retired, which is the table's own documented lifecycle. Widening a retired row means re-adding it, and re-adding a row whose task is `done` is the kind of entry that outlives its meaning and then misleads.

**Second, the constraint it would express is already expressible by the mechanism built for it.** `docs/features/README.md:7` is explicit: the **Depends on** header carries every "runs after X" constraint and selection honours it mechanically; the table carries only "runs *before* Y" and "never gates Y", which `Depends on` cannot express. "049d after 060" is a runs-after constraint. It belongs in 049d's `Depends on` header, where this decomposition puts it, and nowhere else.

The only row this decomposition could justify adding is the optional **"049b - never gates 038"** noted above, and only if the Code Owner wants 049b's non-gating status recorded rather than left implicit. `docs/features/README.md` remains the single source for that table; nothing here or in any other file may carry a second copy.

**Correction for the record:** `plan/049-replan.md:39-41` states that the ledger's ordering exception "reads '060 before 058'; it should read '060 before 058 **and 049**'". That was true when it was written on 2026-08-08 and stopped being true when 060 landed on 2026-08-11 (PR #418). The paragraph should be struck rather than acted on.

---

## The ADR-22 colour-picker gap

**It affects exactly one sub-task, 049d, and it affects it as an accepted cost rather than a blocker.**

The a2ra registry has no colour input, swatch or palette control, so the editor's 36 colour rows use a typed hex `text-field` with inline validation and a non-interactive swatch. `plan/wireframes/admin-theme-editor.md` already states the cost plainly, and it is worth restating because a reviewer will ask: no visual picking, no eyedropper, no wheel, no alpha. An operator picks colours in a tool they already have and pastes them.

**The gap needs an upstream issue filed before 049d dispatches**, per ADR-22 (a needed component absent from the registry is a cross-repo issue, never an invention), and a row added to the running list at `docs/wireframes/README.md:21-29`, which today carries Pagination, Toast and Progress and no colour row. That row and the issue are the deliverable; the editor does not wait on them, because the typed-hex fallback is a complete path rather than a stopgap.

**Two cautions.**

- **Do not let it become a hand-rolled picker.** `scripts/check-admin-theme.mjs` fails the build on any hex, `rgb()` or `oklch()` literal anywhere under `apps/admin/app` or `apps/admin/components` outside `apps/admin/app/theme.css`, so a picker built here would fight a gate that exists for a good reason. That gate is a structural ally, not an obstacle.
- **This is stated but not verified from this checkout.** The sibling `a2-react-aria` checkout is present but empty here. What is verified is that `packages/ui/src/components/a2ui/` contains no colour component and that neither `packages/ui/src/kit.ts` nor `apps/admin/components/kit.tsx` exports one. Confirm against the registry before filing the upstream issue, so it names what is actually missing.

Under **Path 1** the gap affects nothing: a read-only contrast readout takes no colour input.

---

## What this decomposition does not change

The recommendation in `plan/049-replan.md` is unchanged: **Path 1**. This document exists so that Path 2 is a costed option rather than an unexamined one, and so that if the Code Owner takes it, no session has to re-derive the split. Four sub-tasks, one of which reopens a proven guarantee, one of which cannot show its own states at its own gate until two others land, against a 1.0 already gated on 040, two human gates and an external tester.
