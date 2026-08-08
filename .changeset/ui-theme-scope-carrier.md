---
"@qcms/ui": minor
---

Give the token contract a **scope carrier** so a themed subtree is expressible
(task 060, ADR-38). Every rule in `theme.css` (20 blocks) and the generated
`fonts.css` (23 blocks) is re-anchored from `:root` to
`:is(:root, [data-qcms-theme-scope])`, so the token set applies to the document
root **or** to any element carrying the attribute. `theme-components.css` goes
further and is anchored on the **bare** attribute: its rules describe treatment
over `[data-rac]` elements, which every host on the same component kit renders
too, so only making the attribute the sole carrier contains them.

**Backwards compatible for a consumer of `theme.css` / `fonts.css`.** `:root`
keeps matching, and the rewrite is provably specificity-neutral:
`[data-qcms-theme-scope]` is (0,1,0) exactly as `:root` is, and `:is()` takes its
most specific argument, so no rule moved and none can flip. An adopter's plain
`:root` overrides work exactly as they did. `theme-tokens.test.ts` now computes
real CSS specificity rather than counting characters and asserts that each
anchored selector scores exactly what its pre-rewrite `:root` form scored.

**Two things a consumer of `theme-components.css` must know.** Its rules now
require an ancestor carrying `data-qcms-theme-scope`, so a host that imported it
against a plain `<html>` must stamp the attribute there (the portal does). And
its `@theme` block is unscopable by construction, since Tailwind theme variables
are global to a build: importing the sheet raises `text-sm` to `--type-body` and
`text-xs` to `--type-hint` app-wide, and a host that does not want that re-pins
the two steps in its own later `@theme` block.

Contract documentation: `docs/theming.md`.
