# Task 058: how the 051 theme sheet gets container-scoped

**For:** the Code Owner. **From:** the PM/PO seat, 2026-08-07.
**Decision needed:** one of three options, or "leave 058 parked".

Task 058 (preview theme island) hit its exit-criterion-7 fence before a line of code was
written, which is the fence working. It wants a respondent theme/mode switch scoped to the
admin's form preview, and `packages/ui/src/theme.css` anchors **every** theme, mode,
density, radius and font block on `:root` - 20 rule blocks, zero non-`:root` selectors. An
island element cannot match any of them. Changing that is a 051-token-contract decision,
which is yours.

Everything below was verified against current `main`, not reasoned from memory. Where my
own earlier reasoning was wrong, I have said so rather than quietly correcting it.

## The seam that exists today

034 built `.qcms-preview-surface` (`apps/admin/app/globals.css:924-927`), and it is exactly
two declarations - `isolation: isolate` and `container-type: inline-size`. Its own comment
says it is "a boundary rather than a theme... nothing here reads a theme knob." So the seam
058 was told to mount on is a **stacking and layout boundary**, not a theme boundary. That
is not a defect; it is 034 correctly declining to make this decision.

Two facts make the problem harder than it looks:

1. **Admin already overrides the portal's tokens.** `apps/admin/app/globals.css:30-32`
   imports the portal `theme.css` then Cobalt's `./theme.css`, which re-declares the same
   custom properties on `:root`, later in source order, at equal specificity. Inside admin,
   the whole portal token set already resolves to Cobalt values - **including geometry**:
   portal radii are 6px/10px/4px, Cobalt's are 4px/8px/2px. An island that re-declared only
   colours would still render portal controls with admin corner geometry.
2. **The portal's high-contrast *treatment* is absent from admin entirely.** Admin does not
   import `theme-components.css`. Importing it app-wide is not neutral: its eleven non-HC
   rules anchor on `[data-rac]`, and every admin control is a `[data-rac]` element via
   `apps/admin/components/kit.tsx`. It would restyle admin's entire control layer, and
   asymmetrically - radii would resolve to Cobalt while `min-height` resolved to the
   portal's 44px, because Cobalt declares `--admin-control-h` and not `--space-control-h`.

One piece of good news: I diffed the token *name* sets. Cobalt declares exactly eight
properties the portal sheet does not, and **none is renderer-consumed**. So "nothing
leaks in" is achievable. It is the HC treatment half that is hard.

---

## Option A′: make the scope attribute the carrier (recommended)

Two changes, different in kind:

- **Token sheets** (`theme.css`, `fonts.css`): rewrite each anchor to
  `:is(:root, [data-qcms-theme-scope])`.
- **Treatment sheet** (`theme-components.css`): anchor on **bare
  `[data-qcms-theme-scope]`**, and have the portal stamp that attribute on its `<html>`
  (one line in `apps/portal/app/layout.tsx`).

**Why the second half matters.** Scoping the token sheet alone does not contain the
treatment rules - they have no `:root` in them, so prefixing achieves nothing while every
admin control remains a descendant of `<html>`. Making the attribute the carrier makes
containment real: admin's chrome is not inside the island, so **admin can import
`theme-components.css` with zero blast radius** and the island gets the genuine portal HC
treatment. This is the only shape found that satisfies both halves of exit criterion 2
without app-wide side effects.

**It is provably specificity-neutral.** `:root` is (0,1,0); `[data-qcms-theme-scope]` is
(0,1,0); `:is()` takes its most specific argument. The rewrite moves every selector by
exactly zero. That matters for one fragile thing: `docs/theming.md:61-62` records that the
`.hc` blocks must be emitted after the light/dark blocks *because* they have equal
specificity - source order is load-bearing. Both sides move by zero, so it survives
untouched. All 20 blocks checked; none can flip.

**A correction to my own earlier reasoning.** I had argued `:where()` would fail because its
zero specificity would lose to admin Cobalt's plain `:root`. That contest never happens:
Cobalt's `:root` does not match the island at all, it matches `<html>`, and tokens reach the
island by **inheritance** - a declaration *on* an element always beats a value *inherited*
into it, at any specificity. The conclusion (use `:is()`) survives for a better reason:
`:is()` needs no cascade audit, whereas `:where()` would drop 50 blocks to zero specificity
and silently re-rank them against the adopter override surface
(`apps/portal/app/adopter-theme.css`, written as plain `:root`) and admin's own 14 `:root`
rules.

**Cost:** 61 selector lines across three sheets. No new files. One attribute in the portal
layout. A changeset, since `@roonga/qcms-ui` is publishable, and two normative sections of
`docs/theming.md`.

**The one dangerous item, which is why this is not a rider.**
`packages/ui/src/theme-tokens.test.ts:70` computes specificity with a hand-rolled model -
count of `.` plus count of `[` - and uses it to resolve theme x mode before **computing the
WCAG contrast ratios from that resolution**. After the rewrite every selector gains one
`[`, so base blocks would rank equal to `.hc` blocks. This does not fail loudly; it
**certifies the wrong pairs**. It must be fixed deliberately, not made to pass. (That model
is a latent trap independent of 058 and is getting its own issue.)

**Backwards compatible** - `:root` keeps working, so adopters and any external consumer of
`@roonga/qcms-ui/theme.css` see nothing. **Reversible** - if the iframe is later wanted for another
reason, none of this has to be undone.

---

## Option B: the iframe

Give the preview its own document, so `:root` means what it says, the portal stylesheets
apply unmodified, and Cobalt is not in that document at all. It is the only option that
satisfies exit criterion 7 as literally written ("no `@roonga/qcms-ui` source changes"), and read
that way, the fence 034 built was pointing here.

**I am not recommending it, for one reason that is not about effort.** Admin sets
`X-Frame-Options: DENY` and `frame-ancestors 'none'` / `frame-src 'none'`, and
`docs/SECURITY_DESIGN.md:119` treats that as deliberate: "portal embedding of forms is a
Phase-4 decision, not an accident." Framing itself means relaxing all three, updating the
tests that assert them, and re-reasoning 040's checklist. Mechanically trivial. But it
converts an invariant that is **categorical and testable** into one that is conditional on
a path prefix, and spends that on a theme switcher.

The second cost is structural: a framed preview needs its own `<html>`, which in Next means
deleting `app/layout.tsx` and moving all seven existing route trees - including the auth
screens - into a parallel route group. A wide diff in territory unrelated to preview.

Three quieter losses worth knowing: **ARIA cannot cross a document boundary**, so the
switcher cannot label or control what is inside the frame and the preview's heading stops
labelling the rendered region; **iframes do not size to content**, so either a fixed height
or a `ResizeObserver` protocol; and `apps/admin/e2e/support/capture.ts:110` - the guard that
refuses to shoot an overflowing frame, which exists because PR #245 shipped six mislabelled
frames, and which is the **only** place WCAG 1.4.10 reflow gets caught since axe does not
test it - reads the top document only. Content overflowing inside the iframe silently stops
being covered. Keyboard traversal, for what it is worth, is fine: same-origin frames join
the top document's focus order natively.

Also 17 e2e locator sites need `frameLocator()`, and the preview becomes a separate document
permanently - so "click a control in the preview to select that question in the builder", a
natural next ask for a form builder, becomes a postMessage protocol.

**I would flip this to first under one condition:** if you also want a real "view this form
as a respondent" affordance. 034 already ships secure links, so the capability is adjacent.
If the frame route pays for itself twice, its costs stop being overhead and start being
infrastructure. As a means to a theme switcher alone, it spends its budget in the worst
possible place.

---

## Option C: a generated scoped duplicate (the conservative fallback)

Generate `packages/ui/src/theme-scoped.css` from `theme.css` by selector rewrite, commit it,
guard it against drift, and have **admin import it alone**. The precedent is real and
well-formed: `fonts.css` is already generated from a manifest with a drift test asserting
the committed file matches what the generator renders today.

**Its distinguishing virtue: it changes nothing the portal or an adopter can observe.**
`theme.css` stays byte-identical, so `theme-tokens.test.ts`, `font-registry.test.ts`,
`docs/theming.md` and every adopter's `adopter-theme.css` are untouched, and respondents pay
zero bytes. Strictly speaking it is not a 051-contract change at all - which is a real
answer to the fence 058 hit.

**Its distinguishing risk: a semantic drift the obvious guard does not catch.** Two sources
of truth. A "did you regenerate?" test proves only that the committed file matches today's
generator, not that the generator is correct. If a generator bug changes a *value*, the
scoped sheet ships an unverified palette while `theme-tokens.test.ts` keeps certifying the
unscoped one. The guard must assert *identical modulo the anchor substitution*,
declaration by declaration. Stateable and testable - it just has to be stated.

**Cost:** ~940 generated lines, ~150 of generator, ~80 of guard, one `check:all` entry, one
package export. Lowest risk to the respondent surface, highest maintenance thereafter.

---

## Option D, ruled out: native CSS `@scope`

Presented only so it is visibly considered rather than missed.

**It does not do what its name suggests.** `@scope` limits where selectors *match*; it does
not isolate inherited properties, and design tokens **are** inherited custom properties.
Chrome's own documentation is blunt: "`@scope` limits the reach of the selectors. It doesn't
offer style isolation." It also requires the same 50 selector rewrites as Option A′, plus
at-rule wrappers, plus a new cascade step.

And the support floor is real: MDN puts it at **Baseline "newly available" since
2025-12-12**, with *widely available* around mid-2028. **Firefox ESR 140 has no `@scope` and
is supported to October 2026**; ESR 115 persists to March 2027. Those are exactly the
browsers an institutional or government respondent runs, which is the audience our WCAG 2.2
AA and no-JS commitments exist for. Our Playwright matrix is **Chromium in all four
projects**, so no gate we run could catch such a regression - the risk would be carried by
review rather than by CI.

---

## Recommendation

**Take A′.** It is provably specificity-neutral, it is the only CSS shape that gets the
portal HC treatment into an admin island with zero blast radius, it is backwards compatible,
and it forecloses nothing. Its honest weaknesses are that it is a genuine 051-contract change
(yours, which is why the fence held correctly) and that the `specificityOf` model in
`theme-tokens.test.ts` must be corrected deliberately rather than made to pass.

**Take B instead if** you want a "view as respondent" affordance anyway - then the frame
route pays for itself twice and the security-header change buys something real.

**Take C if** the overriding priority is that the respondent surface and adopters observe
nothing at all.

## Three things 058's task file needs regardless of the choice

Found while investigating; none is a decision, all would otherwise surface mid-implementation.

1. **The question preview has no seam.** `components/questions/question-preview.tsx:118`
   uses only `.qcms-preview`. 058's "reusable shape" deliverable covers it, so 058 must add
   the seam there - which trips `renderer-surface.test.ts:114-127`'s "exactly twice"
   assertion and its two-module list.
2. **`renderer-surface.test.ts:129-144` must be inverted, not deleted.** It currently asserts
   the preview modules contain none of `qcms-app-mode`, `QCMS_PORTAL_THEME`, `portalTheme`,
   `setTheme`. 058 has to relax it; if it is simply removed, the guard silently becomes a
   no-op.
3. **An admin-side JS map of token values is not implementable**, independent of 058's own
   rule against it: `scripts/check-admin-theme.mjs` (in `check:all`) fails the build on any
   colour literal anywhere under `apps/admin/app` or `apps/admin/components` outside
   Cobalt's own sheet.
