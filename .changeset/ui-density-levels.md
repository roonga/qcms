---
"@roonga/qcms-ui": minor
---

Add the three density levels to the spacing group of the token contract (ADR-30,
task 053). `theme.css` now ships `:root.density-compact` and
`:root.density-spacious` alongside the base Comfortable block, each overriding all
five `--space-*` values; the portal's respondent density control swaps one root
class.

| Token | Compact | Comfortable | Spacious |
| --- | --- | --- | --- |
| `--space-control-h` | 36px | 44px | 52px |
| `--space-control-pad-x` | 0.7rem | 0.9rem | 1.1rem |
| `--space-field-gap` | 1.25em | 2em | 2.75em |
| `--space-section-pad` | 1.5rem | 2.25rem | 3rem |
| `--space-stack` | 0.375rem | 0.5rem | 0.75rem |

Additive and backward compatible: a consumer that sets no density class gets
exactly the values it had before. Three invariants are enforced by
`theme-tokens.test.ts` over the shipped CSS, so a level cannot quietly break the
other groups' guarantees: a density block may set ONLY the five spacing tokens
(never a `--type-*` floor or a `--color-*` pair), `--space-control-h` never drops
below the WCAG 2.5.8 minimum of 24px at any level, and the three levels stay
monotonically ordered on every token.
