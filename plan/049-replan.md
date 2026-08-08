# Task 049 re-plan: the theme editor is an arc, not a screen

**For:** the Code Owner. **From:** the PM/PO seat, 2026-08-08.
**Decision needed:** which of two paths 049 takes for 1.0. Everything else here follows from that.

## Why this document exists

049 was promoted to launch-required on 2026-08-07 on the understanding that it was one admin
screen depending on two landed tasks (031, 047). Drafting its wireframe - which its own task
file requires before dispatch, and which did not exist - established that it is not.

The finding that decides it, verified directly rather than reported:

```
grep -rni "theme" apps/api/src   ->  0 hits
```

There is no theme slice, no config-store table, no OpenAPI path. Theme selection today is
`process.env`, resolved at SSR in `apps/portal/lib/server/theme.ts`. So "save the result as a
**named custom theme**" - the central deliverable - has nowhere to be saved.

And `PORTAL_THEMES` is a **closed four-value const union** compiled into the portal, with each
theme's tokens as static blocks in `packages/ui/src/theme.css`. A saved custom theme therefore
cannot reach a respondent through any mechanism that exists. That is not a missing endpoint; it
is a missing runtime capability.

## What 049 actually contains

Five separable pieces. Only the last is the screen its task file describes.

| | Piece | Depends on | Notes |
|---|---|---|---|
| **A** | **Theme persistence**: table + migration, API slice, OpenAPI paths, admin BFF routes | - | No UI. Wholly unscoped today. |
| **B** | **Portal runtime token emission**: a custom theme's properties reach a respondent as an SSR inline block on `<html>` | A | **Touches 053's no-flash guarantee**, which was proven by first-frame sampling. New runtime mechanism, not a config value. |
| **C** | **Contrast module extraction**: a runtime-importable contrast function in `@qcms/ui` | - | Small. Today it exists only as test-private helpers in `theme-tokens.test.ts` (`luminance` calls `expect()` internally, so it is structurally unusable outside vitest), plus a second copy in `apps/admin/e2e/appearance.pw.ts`. Needs a changeset. |
| **D** | **The editor screen** | A, B, C, **060** | The live preview needs 060's scope carrier for the same reason 058 did. |
| **E** | **Colour picker** | upstream | `[upstream gap]` under ADR-22: the a2ra registry has no colour input, swatch or palette control. A cross-repo issue, never an invention. |

**The ledger does not record D's dependency on 060.** Its ordering exception reads "060 before
058"; it should read "060 before 058 **and 049**". Without 060, an unscoped preview inside admin
renders admin colours *and admin geometry* - Cobalt re-declares the same 36 colour tokens and
`--radius-*` on a bare `:root`, imported after the portal sheet at equal specificity. That is
precisely the fence 058 hit.

## The other problem: 049 is written against a contract that did not ship

049 says "grouped token editing per the four-group contract (color/type/spacing/radius)".
051-053 shipped something narrower, and three of those four groups are not a theme's to edit:

- **Colour is the only group a theme actually varies.** `data-theme` switches the 36 `--color-*`
  tokens and nothing else. Corners, font, density and brand mark shipped as *orthogonal
  deployment axes* (`QCMS_PORTAL_CORNERS`, `_FONT`, `_DENSITY`, `_BRAND_*`), not as part of a
  theme.
- **The type scale cannot be lowered.** `--type-*` are WCAG 1.4.12 floors and
  `theme-tokens.test.ts` fails any block that lowers one.
- **Spacing belongs to the respondent.** `--space-*` moves only with density, which ADR-30
  assigns to the respondent's own controls. An operator editing it would override a user's
  accessibility choice.
- **Radius is four presets**, not editable tokens.

So even the full build cannot deliver "edit four groups" as written. It can deliver *edit
colour, choose corners and default font*, which is a different and smaller thing.

**Also stale and worth fixing either way:** ADR-30's *Scope* paragraph carries the 2026-07-25
amendment moving the custom-theme editor to launch tier, while its **Consequences** paragraph
still reads "the save-custom-theme admin UI is Phase-4" (`docs/PROJECT_GOAL.md:240`).
`apps/portal/lib/server/theme.ts`'s header comment says the same. The ADR contradicts itself.

---

## Path 1 (recommended): descope to what the override point already supports

**Ship for 1.0: C, plus a read-only contrast checker in the admin, plus documentation of the
`adopter-theme.css` override point ADR-30 already preserves.**

An operator customises tokens by editing the override stylesheet the contract was designed to
expose, and the admin gives them the thing they cannot get anywhere else: **an inline AA
contrast verdict on their own palette**, computed by the same module the gate uses.

- **Drops A, B and D entirely** - no table, no slice, no runtime emission, no dependency on 060.
- **Keeps the honest value.** The hard part of theming is not a form; it is knowing whether your
  colours pass AA in light, dark and high contrast. That is what C plus a checker delivers.
- **One task, not four.** Small enough to land inside the 1.0 window without displacing 040.
- **Named custom themes become Phase 4**, where ADR-30's Consequences paragraph already puts
  them - so this resolves the ADR's self-contradiction in the direction the code already took.

What it does not deliver: an operator cannot name and save a theme from the UI, and cannot
switch between several custom themes without editing config. That is a real reduction and it
should be stated in the release notes rather than glossed.

## Path 2: build the arc, re-planned as four tasks

If named custom themes are genuinely launch-tier, 049 is replaced by:

- **049a** theme persistence (A)
- **049b** portal runtime token emission (B) - *the risky one; it reopens the no-flash guarantee*
- **049c** contrast module extraction (C) - *independent, can start now*
- **049d** the editor screen (D) - *after 060*

Plus an ADR-22 cross-repo issue for E, filed before 049d dispatches.

Honest cost: four tasks, one of which touches a guarantee 053 proved with first-frame sampling,
plus 060 promoted onto the critical path, plus an upstream dependency we do not control. Against
a 1.0 that is already gated on 040, two human gates and an external tester.

## What I would do

**Path 1.** The deciding argument is not effort, it is that **Path 2's central deliverable
cannot be gated.** Every state involving a saved custom theme is unreachable in fixtures until
A and B both land, so 049d's screenshot gate - the thing that makes a UI task reviewable here -
would be signed against states the feature's whole point never reaches.

A launch feature whose evidence cannot be produced at the moment of review is the wrong shape to
put in front of a launch gate.

## If Path 1 is chosen, the changes are

1. Rewrite `docs/features/049-*.md` to the descoped deliverable, and retitle it so the ledger row
   stops promising a named-theme editor.
2. Fix ADR-30's Consequences paragraph and `theme.ts`'s header comment - both now agree with the
   code rather than contradicting the Scope paragraph.
3. File the named-custom-theme editor as a Phase-4 issue carrying this document's findings, so
   the analysis is not lost.
4. File the ADR-22 colour-picker gap upstream regardless - Path 1 does not need it, but the gap
   is real and the running list in `docs/wireframes/README.md` is where it belongs.
5. Leave the ordering exception alone: without D, 049 no longer depends on 060.
6. `plan/wireframes/admin-theme-editor.md` stays unsigned and becomes the Phase-4 issue's
   attachment rather than a gate artifact.
