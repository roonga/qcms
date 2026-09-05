---
"@roonga/qcms-ui": minor
---

Give `--space-section-pad` a viewport dimension in `theme.css`, so the step card is
padded for a phone again (issue #188, Code Owner decision 2026-09-02).

Task 051 replaced the card's `p-5` / `sm:p-8` with a single
`p-(--space-section-pad)`, and the token was flat at `2.25rem`. A 412px phone
therefore spent 72px of its width on card padding where it had spent 40px. The
token now carries the breakpoint the component gave up: the three density blocks
are written mobile-first and one `@media (min-width: 40rem)` block - Tailwind's
`sm`, the width the old `sm:p-8` turned over at - raises all three to the values
that shipped flat.

| `--space-section-pad` | Compact  | Comfortable | Spacious |
| --------------------- | -------- | ----------- | -------- |
| narrow                | 0.875rem | 1.25rem     | 1.75rem  |
| `sm` and wider        | 1.5rem   | 2.25rem     | 3rem     |

Comfortable's narrow value is the pre-051 `p-5`, so the phone layout the token
contract ships is the phone layout that was reviewed. The narrow steps keep the
same 0.7x and 1.33x either side of Comfortable that the wide values use, which is
what keeps choosing Compact on a phone a visible choice.

Minor rather than patch: nothing in the contract is renamed or removed, and the
step card still carries one token reference with no Tailwind variant, but a
consumer's narrow-viewport card padding changes without them opting in, so this is
a release note to read rather than an invisible fix.

The four-group contract (ADR-30) and the scope carrier (ADR-38) are unchanged, and
only `--space-section-pad` moves with width: the other four spacing tokens are
about fingers and rhythm rather than screen width. `theme-tokens.test.ts` now
resolves the sheet at both ends of the breakpoint and asserts that the media block
may set spacing tokens only, so no viewport can reach a WCAG 1.4.12 floor, that
`--space-control-h` clears the 2.5.8 target-size floor at every density x viewport,
and that Compact < Comfortable < Spacious still holds narrow as well as wide.
`apps/portal/e2e/theming.pw.ts` measures the rendered card either side of 640px.
