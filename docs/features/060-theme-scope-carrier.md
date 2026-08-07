# 060 - Theme scope carrier: the 051 token contract gains a container anchor

**Stage:** 8a · **Apps/packages:** `@qcms/ui` (the three stylesheets and their tests), `apps/portal` (one attribute), `apps/admin` (one import) · **Depends on:** 051, 052, 053 (the contract this amends), 055 (admin's Cobalt sheet is the thing the island must not inherit)
**References:** **ADR-38** (the decision and every rejected alternative) · `plan/058-theme-scoping-options.md` (the investigation behind it, including the numbers) · ADR-30 + tasks 051/052/053 (the contract) · `docs/theming.md` (normative selector conventions, changed here) · task 058 (the consumer; runs after this)

## Context

Task 058 needs the admin to render a respondent theme inside a container while the admin chrome stays on Cobalt. It cannot: `packages/ui/src/theme.css` anchors **all 20 of its rule blocks** on `:root`, which matches only the document element. 058 correctly stopped at its exit-criterion-7 fence rather than changing the contract as an admin rider.

This task makes the contract expressible against a container, and does **only** that. It ships no user-visible change: the portal renders identically before and after, and adopters see nothing.

## Deliverables

- **Token sheets carry the scope alternative.** Every anchored rule in `packages/ui/src/theme.css` (20 blocks) and `packages/ui/src/fonts.css` (23 blocks) is rewritten from `:root…` to `:is(:root, [data-qcms-theme-scope])…`.
- **The treatment sheet is re-anchored on the bare attribute.** `packages/ui/src/theme-components.css` drops `:root` from its 7 anchored selector lines and gains `[data-qcms-theme-scope]` on its 11 currently-unanchored treatment rules, so containment is real rather than nominal.
- **The portal stamps the attribute** on `<html>` (`apps/portal/app/layout.tsx`), so its rendering is unchanged.
- **`theme-tokens.test.ts`'s specificity model is corrected deliberately** - see the exit criteria; this is the highest-risk item in the task and is not to be "made to pass".
- **`font-registry.test.ts` and the generator template** updated for the new selector shape, and `fonts.css` regenerated.
- **`docs/theming.md`** selector-convention table and "Adding a theme" recipe updated (staleness rule: both are normative and both spell `:root[data-theme=…]`).
- **Changeset** for `@qcms/ui` recording a contract change.

## Exit criteria

1. **The portal is byte-identical in effect.** Computed styles for a representative control are unchanged across all four themes x light/dark/hc, before and after. `:root` still matches, so an adopter's `adopter-theme.css` (plain `:root`) overrides exactly as it did.
2. **The rewrite is specificity-neutral, and this is asserted rather than assumed.** `:root` and `[data-qcms-theme-scope]` are both (0,1,0) and `:is()` takes its most specific argument, so no rule may flip. In particular the `.hc` blocks must still win over the `[data-theme]` blocks by source order alone, which `docs/theming.md` records as load-bearing.
3. **`theme-tokens.test.ts` resolves theme x mode correctly, and its model is no longer hand-rolled by counting characters.** The existing `specificityOf` counts `.` and `[`, so every selector gaining one `[` would rank base blocks equal to `.hc` blocks - and because that resolution feeds the WCAG contrast computation, the suite would **certify the wrong pairs while staying green**. Fix the model, then prove the fix: show the corrected resolution rejecting a deliberately mis-ordered sheet. **A green suite is not evidence here; a suite shown capable of going red is.**
4. **All 12 theme x mode contrast combinations still compute and still pass**, with the ratios unchanged from the current committed values.
5. **A scoped container genuinely resolves portal tokens.** A test mounts an element carrying `data-qcms-theme-scope` with a theme attribute and mode class inside a document whose `:root` carries different values, and asserts the element's computed custom properties are the portal's - **including a geometry token** (`--radius-control`), not only colour, since that is the divergence an island would otherwise miss.
6. **`theme-components.css` contains the admin case.** With admin importing it, an assertion shows the portal HC treatment applies inside a scoped container and **does not** apply to a `[data-rac]` control outside one. This is the half the whole approach exists for.
7. `pnpm verify` green with `turbo run test --force` reporting `0 cached`; `pnpm verify:browser` green; changeset present; `docs/theming.md` updated in this PR.

## Out of scope (binding)

The switcher UI, the island, and anything under `apps/admin` beyond the single stylesheet import (that is 058). Font or density switching. Custom themes (049). Any change to token *values*, to the four-group contract, or to which themes exist - this task changes **where rules match**, never what they say. Do not introduce a generated scoped duplicate sheet; ADR-38 records it as the fallback and taking it is an amendment, not an implementation choice.

## Notes for the executor

**Do not "simplify" `:is()` to `:where()`.** They differ by exactly the property that makes this safe: `:where()` is specificity 0 and would silently re-rank 50 blocks against the adopter override surface. ADR-38 records the full reasoning, including why the intuitive argument for `:is()` is wrong even though the conclusion is right.

**Expect the contrast suite to be the hard part**, not the CSS. The CSS rewrite is mechanical and provably neutral. The test that reads that CSS is where a silent wrong answer lives.
