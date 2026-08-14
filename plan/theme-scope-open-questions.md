# Theme scope: the two open questions after 060 landed

**For:** the Code Owner. **From:** the PM/PO seat, 2026-08-13.
**Companion to:** `plan/058-theme-scoping-options.md` (the pre-decision options paper, now historical: ADR-38 was taken and task 060 shipped it as PR #418).
**Decisions needed:** one on issue #442, one on whether task 058 dispatches as written.

Everything below was verified against the tree at `main` (14a81ff) and, where a mechanism was in doubt, by compiling the pinned toolchain directly rather than reasoning from memory. Two claims in currently-open issues turn out to be wrong; both are named with the evidence.

---

## Part 1: issue #442, the QCMS app's type scale

### 1.1 What is pinned, and where the floors live

**The floors** are the `--type-*` group in `packages/ui/src/theme.css:66-92`, under the normative comment at `:54-64`:

| token | value | what it carries |
|---|---|---|
| `--type-body`, `--type-label` | `1rem` (16px) | body and label size |
| `--type-hint` | `0.875rem` (14px) | hint, description, error |
| `--type-line-height` | `1.5` | WCAG 1.4.12 line spacing |
| `--type-letter-spacing` | `0.12em` | WCAG 1.4.12 |
| `--type-word-spacing` | `0.16em` | WCAG 1.4.12 |
| `--type-paragraph-spacing` | `2em` | WCAG 1.4.12 |

They are asserted from the sheet by `packages/ui/src/theme-tokens.test.ts:460-520` and re-measured on rendered text by `apps/portal/e2e/appearance.pw.ts` (summarised in `docs/theming.md:581-586`).

**The bridge to Tailwind** is the `@theme` block in `packages/ui/src/theme-components.css:61-70`, which repoints Tailwind's two sub-16px steps at those tokens.

**The re-pin** is `apps/admin/app/globals.css:56-62`, added by 060 so the sheet could be imported at all. The delta, quoted from both files:

| variable | `theme-components.css:61-70` | `globals.css:56-62` | effect in the QCMS app |
|---|---|---|---|
| `--text-sm` | `var(--type-body)` = 16px | `0.875rem` = 14px | -2px |
| `--text-sm--line-height` | `var(--type-line-height)` = 1.5 | `calc(1.25 / 0.875)` ~= 1.429 | -0.071 |
| `--text-xs` | `var(--type-hint)` = 14px | `0.75rem` = 12px | -2px |
| `--text-xs--line-height` | `var(--type-line-height)` = 1.5 | `calc(1 / 0.75)` ~= 1.333 | -0.167 |
| `--text-base--line-height` | `var(--type-line-height)` = 1.5 | `calc(1.5 / 1)` = 1.5 | none |

**The 139 call sites check out.** `apps/admin/app` plus `apps/admin/components` contain 147 occurrences of the two class names; 8 of them are the re-pin block and its comment in `globals.css`, leaving 139 in `.tsx`. The number in #442, #404 and the `globals.css` comment is current, not stale.

### 1.2 Is the re-pin a correct fix, a workaround, or a masked regression?

It is a **workaround that is honest about its own mechanism, over a policy gap that is older and wider than the re-pin, and that is not a WCAG 2.2 AA failure.** Four separable findings:

**(a) There is no AA success criterion the QCMS app is failing here.** No WCAG 2.2 AA criterion mandates a 16px body or an authored 1.5 line-height. SC 1.4.12 (Text Spacing, AA) requires that content survive a **user override** to line-height 1.5 / letter-spacing 0.12em / word-spacing 0.16em / paragraph 2em; it does not require authoring at those values. SC 1.4.4 (Resize Text, AA) is about 200% zoom. The `--type-*` floors are therefore a **project policy stricter than AA**, adopted by 051 for the respondent surface. #442's framing as "pinned below the type floors" is exactly right; reading that as "below AA" would not be.

**(b) The QCMS app's body text is already at the floor.** Tailwind's preflight sets `line-height: 1.5` on `html` (`tailwindcss@4.3.3/preflight.css:30`), and `apps/admin/app/globals.css:125-132` sets no `font-size` on `body`, so base text is 16px at 1.5. `plan/admin-theme/ADMIN_THEME.md:74-76` ("Type floors are unchanged: body >= 16px, line-height >= 1.5") is therefore **true of body text and silent about the secondary scale**. It is not a contradiction, but it is the sentence a reader would mistake for a whole-app guarantee.

**(c) The genuine gap is much wider than the re-pin, which is the finding that should decide the option.** `apps/admin/app/globals.css` carries **22 hand-written `font-size` declarations below `1rem`**, independent of Tailwind: `0.72rem` (~11.5px) at `:1077`, `0.75rem` at `:1423`, `0.78rem` at `:715`, `0.8rem` at `:647`, `0.8125rem` at `:1210`, `0.82rem` at `:774`, `0.85rem` at `:1008`, `0.875rem` at `:1187`, `0.9rem` at `:1042`, and a literal `12px` at `:954`. **Deleting the re-pin would raise only the 139 utility call sites and leave all 22 of these where they are**, producing a scale that is neither the signed-off 055 look nor the floors. "Keep the re-pin" versus "raise the app to the floors" is not a one-block decision, and any option paper that treats it as one is understating option B by an order of magnitude.

**(d) What is genuinely untested.** Nothing asserts 1.4.12 override survival or 1.4.10 reflow at these sizes on the QCMS app. `apps/admin/e2e/appearance.pw.ts` covers mode defaulting, no-flash and the Lexend face, and deliberately hard-codes no size. So the operator surface's AA posture on text spacing rests on review in both directions: there is no gate that would catch a real regression, and no gate that currently certifies the status quo either.

### 1.3 The mechanic that #442 and #405 state incorrectly

Both issues assert that the type-scale consequence for the preview island is unreachable by CSS. #405 puts it most sharply:

> **No selector can fix this** - the variable is resolved at build time, not matched at render time.

**That is wrong, and it matters, because it is the sentence that makes 058's constraint 1 look like a build-level problem.** Compiling the pinned Tailwind (`tailwindcss@4.3.3`, the version in the store) over a minimal input emits:

```css
:root, :host {
  --text-sm: 0.875rem;
  --text-sm--line-height: calc(1.25/0.875);
}
.text-sm {
  font-size: var(--text-sm);
  line-height: var(--tw-leading, var(--text-sm--line-height));
}
```

The `@theme` **block** is unscopable, exactly as `packages/ui/src/theme-components.css:48-51` and `apps/admin/app/globals.css:46-54` say. But the **variables it emits are ordinary inherited custom properties, resolved per element at render time**, and the utility reads them through `var()`. Re-declaring them on a subtree in plain CSS scopes the type step for that subtree:

```css
/* apps/admin/app/globals.css, plain CSS, not @theme */
[data-qcms-theme-scope] {
  --text-sm: var(--type-body);
  --text-sm--line-height: var(--type-line-height);
  --text-xs: var(--type-hint);
  --text-xs--line-height: var(--type-line-height);
  --text-base--line-height: var(--type-line-height);
}
```

Unlayered author CSS beats Tailwind's `@layer theme`, and a declaration **on** the carrier beats a value inherited into it regardless, so this holds without an `!important` and without depending on Tailwind internals. It is the same argument `theme-components.css:26-29` already makes for the radius and spacing rules.

**Consequence:** the preview island's type fidelity is five lines of plain CSS in the admin's own stylesheet, not "likely a build-level or component-level choice" as #405 concludes. Constraint 1 of #405 is solved, and #442 item 3 ("It is now load-bearing for 058 ... and no selector can fix it") is overstated on the same error.

The deeper reading of #404's own lesson applies here: *name every mechanism in the sheet, and say which the carrier can and cannot reach*. The `@theme` at-rule cannot be reached. The custom properties it emits can. Those are two different mechanisms that #404 collapsed into one.

### 1.4 The options, with what each breaks

**Option A - keep the re-pin permanently, record it as a decision, guard it.**
Add an ADR clause stating that the operator surface uses Tailwind's default secondary scale while the respondent surface enforces the floors, and add a fourth property to `scripts/check-admin-theme.mjs` (which already owns three QCMS-app theme invariants) asserting the re-pin block is present and matches Tailwind's defaults, so deleting it as "redundant" fails the build.
*Breaks:* nothing. *Costs:* an ADR amendment plus ~30 lines of gate. *Leaves:* the carve-out standing, the 22 hand-written sizes unaddressed, and the preview island still needing the 1.3 subtree override.

**Option B - raise the QCMS app to the floors.**
Delete the re-pin **and** rewrite the 22 sub-1rem declarations in `globals.css`, then re-baseline 055's signed scale.
*Breaks:* task 055's Code-Owner-signed appearance across essentially every admin screen; every gate screenshot under `docs/gates/032`, `033`, `034`, `035`, `048`, `057`, `059` becomes historical; the 40px control density in `plan/admin-theme/ADMIN_THEME.md:71-76` stops fitting 16px labels without a layout pass. This is a design task, not a stylesheet edit, and it needs its own wireframe and screenshot gate.

**Option C - give the app's Tailwind build its own token namespace** (rename the app's steps to `--text-admin-sm` and so on).
*Breaks:* all 139 call sites have to change class name, and the app loses Tailwind's own scale vocabulary. *Buys:* nothing the re-pin does not already buy. The conflict is a name collision that a five-line re-pin already resolves. Not recommended under any reading.

**Option D - move the floors off `@theme` and onto the scope carrier in `theme-components.css`.**
Replace the `@theme` block at `packages/ui/src/theme-components.css:61-70` with a plain block on the carrier:

```css
[data-qcms-theme-scope] {
  --text-sm: var(--type-body);
  --text-sm--line-height: var(--type-line-height);
  --text-xs: var(--type-hint);
  --text-xs--line-height: var(--type-line-height);
  --text-base--line-height: var(--type-line-height);
}
```

The portal already stamps the carrier on `<html>` (060), so the portal is unchanged: Tailwind's own default theme still defines the `text-sm` and `text-xs` **utilities**, and this block overrides their **values** for the whole portal document. The QCMS app's re-pin then has nothing to undo and is deleted. **This removes the carve-out rather than documenting it**, and it makes every mechanism in that sheet reachable by the carrier, which is the property ADR-38 claimed and #404 correctly said it did not have.
*Breaks:* it is a `@qcms/ui` contract change and needs a changeset; `docs/theming.md:183-186` describes the `@theme` mechanism and must change with it; `packages/ui/src/theme-scope.test.ts:37-46` currently strips the `@theme` block before feeding the sheet to jsdom, and that hack disappears (the floors become assertable in that suite, which is a gain); an external adopter importing `theme-components.css` without stamping the carrier loses the floors, but after 060 they already lose every other rule in that sheet the same way, so this is consistent rather than a new burden.
*Costs:* one small task or one issue-loop PR.

**Option E - a build-time split** (two Tailwind entry stylesheets, one per surface).
*Breaks:* Next's single global stylesheet convention for the app, and gives the admin two CSS pipelines to keep in step. *Buys:* nothing over D.

### 1.5 Recommendation (this is a recommendation, not a report)

**Take D, then A's documentation half.** Concretely: move the floors onto the carrier in `theme-components.css`, delete `apps/admin/app/globals.css:56-62`, and record in the ADR-38 amendment #404 already asks for that the operator surface deliberately uses Tailwind's default secondary scale while the respondent surface carries the floors on the carrier.

Three reasons, in order of weight:

1. **It closes #442 by removing the thing that needed recording.** A carve-out that no longer exists needs no ADR clause, no stylesheet comment and no build assertion protecting a block from deletion.
2. **It is the only option that repairs ADR-38's actual defect.** #404's correction (`docs/PROJECT_GOAL.md:333` still claims "zero blast radius" with no precondition) can be fixed by adding a sentence, or by making the sentence true. Making it true is the same size of change and leaves nothing to remember.
3. **It removes 058's constraint 1 at the source**, so the preview island needs no admin-side override at all and no future reader has to rediscover why one exists.

D does **not** raise the QCMS app to the floors, and should not be sold as doing so: the 22 hand-written sub-1rem declarations stay exactly where they are. That is Option B, it is a design task with its own gate, and it is not launch-gating. If the Code Owner wants it, it belongs behind 035 as its own numbered task, not inside #442.

**If D is judged too much movement in `@qcms/ui` this close to 040**, take A and let 058 carry the five-line subtree override from 1.3. That path is strictly worse only in that it leaves a carve-out to be documented and guarded, and it is entirely defensible.

### 1.6 The one-line question for the Code Owner

> **#442: close it by moving the type floors onto the scope carrier in `theme-components.css` so the QCMS app's re-pin can be deleted (Option D), or by an ADR amendment plus a build guard that keeps the re-pin as a recorded carve-out (Option A)?**

---

## Part 2: will task 058 complete, or park a second time?

**Direct answer: it will complete and park only at its normal human screenshot gate, provided the task file is amended before dispatch on two points. Dispatched exactly as written today, it will park a second time at exit criterion 8, and it will be right to.**

The reason is not the constraint everyone expects. #405's constraint 1 (type scale) is solvable and cheap. #405's constraint 2 (portalled popovers) is real, and every fix for it crosses a fence exit criterion 8 draws.

### 2.1 The two inherited constraints, judged from the code

**Constraint 1: the island renders portal controls at the QCMS app's type scale.**
Real, and it does reach the respondent controls: `packages/ui/src/components/a2ui/text-field/text-field.styles.ts:3,6,7`, `.../checkbox/checkbox.styles.ts:12,13,14,31,35,36`, `.../select/select.styles.ts:7,11,27,28,29` and eleven other style modules put `text-sm` on labels and `text-xs` on descriptions and error slots. Inside the QCMS app those resolve to 14px/12px.

**Solvable, by the technique in 1.3 above** - a plain `[data-qcms-theme-scope] { --text-sm: var(--type-body); ... }` block in `apps/admin/app/globals.css`. No `@qcms/ui` change, no dependency, five lines, and it is exactly what the portal resolves to.

A second half is worth naming because it is not in either issue: **the `--type-*` tokens have no consumer inside the island either.** They resolve correctly on the carrier (`packages/ui/src/theme.css:66`), but what applies them is `apps/portal/app/globals.css:71-82`, which is the **portal app's** stylesheet and is not imported by the admin. So the island also needs the portal's own `body` rule restated on the carrier: `font-family: var(--font-portal, ...)`, `font-size: var(--type-body)`, `line-height`, `letter-spacing`, `word-spacing`. Without it the island renders in Lexend at the admin's spacing, which is a fidelity miss no one has flagged. This is admin CSS, squarely inside 058's scope, but it belongs in the task file rather than being discovered at implementation time.

**Constraint 2: react-aria portals popovers to `document.body`, outside the carrier.**
Real, reachable, and not solvable within exit criterion 8 as written.

Which controls: the vendored `Select` (`packages/ui/src/components/a2ui/select/Select.tsx:125`), `DatePicker`'s calendar (`.../date-picker/DatePicker.tsx:105`) and `Menu` (`.../menu/Menu.tsx:39`) each render a react-aria `Popover`. A `singleChoice` question compiles to `Select` above seven options (`packages/a2ui-compiler/src/mapping.ts:35,190`), and **every `date` question renders a calendar popover**, so the gap is reachable in any previewed form containing a date. A portalled popover is not a descendant of the carrier, so it takes neither the carrier's tokens (by inheritance) nor `theme-components.css`'s treatment rules (by selector): it renders in Cobalt.

The named techniques, all verified against the installed packages:

| technique | mechanism | fence it crosses |
|---|---|---|
| `UNSAFE_PortalProvider` from `react-aria/PortalProvider` | `react-aria@3.50.0`'s `Overlay` reads `useUNSAFE_PortalContext()` and portals to `getContainer()` whenever the prop is absent (verified in `dist/private/overlays/Overlay.mjs`). Wrapping the island in it moves every descendant popover inside the carrier, with no vendored-component edit. | `react-aria` is transitive only. Adding it to `apps/admin/package.json` is a **new dependency**, which EC8 forbids and `CONTRIBUTING.md`'s approval policy gates. |
| `PopoverContext` with `UNSTABLE_portalContainer` | The prop exists on RAC 1.20.0's `Popover`, `Modal` and `Tooltip` (`dist/types/src/Popover.d.ts:49`), and `Popover` merges `PopoverContext` through `useContextProps`. | The admin may not import `react-aria-components`: `apps/admin/lib/questions/renderer-surface.test.ts:147-149` asserts zero admin modules mention it, and it is not a declared admin dependency. Reaching it needs `@qcms/ui/kit` to re-export it, which is a **`@qcms/ui` change**, which EC8 forbids. |
| `@qcms/ui` ships a `<QcmsThemeScope>` that stamps the carrier **and** provides the portal container | Cleanest end state: one component owns "this subtree is a theme island", and the portal gets it for free. | Same `@qcms/ui` fence, deliberately. |
| Accept and document | #405's own acceptance clause permits it: *"If the type-scale mismatch is accepted, the preview's own documentation says what it is and is not faithful about."* | None, but see 2.2 criterion 1. |

RAC does **not** re-export the portal provider from its package index (checked `dist/exports/index.mjs`), so there is no route to it that avoids both fences.

### 2.2 Exit criteria, one by one

| # | criterion | verdict |
|---|---|---|
| 1 | island portal-themed at first paint; **"in no state does an island control resolve an admin-Cobalt token value"**; knob documented in `apps/admin/.env.example`, named identically to the portal's | **Partly reachable.** The first-paint half is fine. The "in no state" clause is **failed by constraint 2** on any strict reading: an open `Select` listbox or `DatePicker` calendar is an island control resolving Cobalt values. Also carries unstated work: `QCMS_PORTAL_THEME` exists only under `apps/portal` today, and `scripts/env-reference.mjs:80-81` scans `apps/admin` for env names with `scripts/env-reference.test.ts` failing in both directions, so this criterion drags in a generated row in `docs/operations.md` as well as the `.env.example` line. |
| 2 | switching restyles the island only; topbar byte-identical both directions | **Reachable.** Popovers portal to `body`, so they do not touch the topbar. |
| 3 | all 051 themes, all three modes, HC token asserted on an island control | **Reachable.** `packages/ui/src/theme-scope.test.ts:113-122` already demonstrates the mechanism at unit level. |
| 4 | 032's preview interactivity survives a switched theme | **Reachable.** The example in the criterion is a checkbox, which does not portal. |
| 5 | axe green in the mixed HC/light states | **Reachable.** A Cobalt-on-Cobalt popover is internally consistent, so axe will not flag it - which is precisely why this criterion does not catch constraint 2. |
| 6 | localized switcher labels, keyboard, visible focus | **Reachable.** |
| 7 | screenshot set under `docs/gates/058/` at 390 and 1280 | **Reachable, and it parks the task by design** (a human gate parks the task, not the run). The real risk is a **reject** here if a shot shows an open dropdown or calendar in Cobalt. |
| 8 | `pnpm verify` + `verify:browser`; **no new dependencies**; **no `@qcms/ui` changes beyond 060's**; stop and surface if the island cannot be expressed against the carrier | **Reachable only if constraint 2 is accepted rather than fixed.** Every fix crosses one of the two clauses. |

Findings 1-3 in the task file (`docs/features/058-preview-theme-island.md:38-42`) are all still accurate at `main`: `apps/admin/components/questions/question-preview.tsx:118` still uses only `.qcms-preview`; `apps/admin/lib/questions/renderer-surface.test.ts:108-125` still asserts the seam appears exactly twice across a two-module list and `:127-141` still carries the negative guard to be inverted; `scripts/check-admin-theme.mjs` still fails the build on any colour literal under `apps/admin/app` or `apps/admin/components`.

### 2.3 The minimum amendment

Two edits to `docs/features/058-preview-theme-island.md`, both small, both before dispatch.

**(i) Bound criterion 1's "in no state" clause, or 058 parks on it.** Replace

> and in no state does an island control resolve an admin-Cobalt token value

with

> and no island control **rendered inside the carrier** resolves an admin-Cobalt token value. Overlays react-aria portals to `document.body` (the `Select` listbox, the `DatePicker` calendar, any `Menu`) are **outside** the carrier by construction and are explicitly excluded from this criterion: see the accepted limitation below.

**(ii) Add the acceptance #405 asks for, as a deliverable rather than a note.** Add to Deliverables:

> **The accepted limitation is stated where an author reads it.** Overlays portalled outside the carrier (select listbox, date calendar, menus) render in the QCMS app's own styling, not the previewed theme. This is recorded in the component's own documentation comment and in the `docs/gates/058/README.md` the Code Owner reviews, and one screenshot in the gate set shows an open overlay so the limitation is ruled on at the gate rather than discovered after it. Fixing it needs either a new `apps/admin` dependency (`react-aria`'s `UNSAFE_PortalProvider`) or a `@qcms/ui` addition (re-exporting `PopoverContext`, or a `<QcmsThemeScope>` that owns both the attribute and the portal container), and exit criterion 8 forbids both: raise it, do not take it.

And a third, optional but cheap:

**(iii) Record the type-scale answer so it is not re-derived.** Add to Deliverables:

> **The island restates the portal's own type rule.** `apps/portal/app/globals.css:71-82` is the portal **app**'s stylesheet and is not imported here, so the carrier block in `apps/admin/app/globals.css` sets `font-family: var(--font-portal, ...)`, `font-size: var(--type-body)`, `line-height`, `letter-spacing` and `word-spacing` from the `--type-*` group, and re-declares `--text-sm` / `--text-sm--line-height` / `--text-xs` / `--text-xs--line-height` / `--text-base--line-height` at the portal's values. Tailwind's `@theme` **block** is unscopable; the custom properties it emits are ordinary inherited properties and are overridable per subtree (`.text-sm` compiles to `font-size: var(--text-sm)`). This is plain CSS, not `@theme`, so it changes nothing outside the island.

If the Code Owner takes Option D from Part 1, edit (iii) shrinks to the `font-family` / `font-size` / spacing half: the `--text-*` re-declaration comes for free from `@qcms/ui`.

### 2.4 Sequencing recommendation

058 does not need to wait for #442. The three edits above make it dispatchable now, and Option D can land before or after without changing 058's diff more than deleting five lines. If the Code Owner prefers the tidier order, D is one issue-loop PR and would let 058's task file carry edit (iii) in its shorter form.

---

## Part 3: staleness found while verifying (named for the record)

Each is a contradiction between two committed artifacts, not a matter of taste.

1. **`docs/PROJECT_GOAL.md:236` versus `:240`.** ADR-30's *Scope* paragraph carries the 2026-07-25 amendment putting the save-custom-theme admin UI at **launch tier**; its *Consequences* paragraph in the same ADR still reads "the save-custom-theme admin UI is Phase-4". The ADR contradicts itself, and 049's tier is the thing it contradicts itself about. Already noted in `plan/049-replan.md:64-67`; still uncorrected.
2. **`apps/portal/lib/server/theme.ts:23` and `:124`** both say "the admin UI over the same setting is Phase-4", inheriting the same contradiction into code comments.
3. **`docs/PROJECT_GOAL.md:333`** (ADR-38) still states that the QCMS app can import `theme-components.css` with "zero blast radius", with no mention of the `@theme` re-pin precondition. This is #404 part 2, filed 2026-08-11, still open.
4. **`docs/PROJECT_GOAL.md:343`** (ADR-38) still asserts the mis-certification hazard that #404 part 1 measured as not occurring. Still open.
5. **`plan/049-replan.md:39-41`** says "The ledger does not record D's dependency on 060. Its ordering exception reads '060 before 058'; it should read '060 before 058 **and 049**'." **That row no longer exists.** `docs/features/README.md:12-16` carries exactly two ordering exceptions today (040 and 041), and `:18` records that 060's exception retired when 060 landed. The correct mechanism for 049d is its **Depends on** header, which `docs/features/README.md:7` says selection honours mechanically. See `plan/049-decomposition.md` for the consequence.
6. **`plan/058-theme-scoping-options.md`** is written as a live decision paper ("Decision needed: one of three options"). The decision was taken on 2026-08-07 and shipped as PR #418. It reads as open until you reach the ledger. A status line has been added at its head.
7. **Issue #405 part 1's mechanism claim is incorrect** (see 1.3), and **issue #442 item 3 inherits it**. Both should be corrected on the issues rather than left to mislead the next reader, because the incorrect version makes a five-line CSS fix look like a build-system decision.

## Part 4: what could not be verified from this checkout

- **The a2ra registry's colour-control gap.** The sibling checkout at the expected sibling path is present but empty here, so the registry contents could not be read. What *is* verified: `packages/ui/src/components/a2ui/` contains no colour component, and neither `packages/ui/src/kit.ts` nor `apps/admin/components/kit.tsx` exports one. The claim in `plan/049-replan.md:37` and `plan/wireframes/admin-theme-editor.md` is consistent with the tree but is **unverified against upstream** and should be confirmed before an ADR-22 cross-repo issue is filed naming what is missing.
- **The compiled-CSS byte-identity claim** behind #418 (that the QCMS app's output with the import plus the re-pin equals its output without either). It is asserted in the PR and in `apps/admin/app/globals.css:46-54`; this checkout cannot run `pnpm`, so it was not re-executed. The mechanism is sound and the Tailwind compilation above corroborates it, but treat the byte-identity itself as reported, not re-verified.
- **Rendered-pixel behaviour of the subtree override in 1.3.** The Tailwind output was compiled directly and the cascade argument is standard, but no browser was driven. 058's own Playwright leg is where that becomes evidence.
