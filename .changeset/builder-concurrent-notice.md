---
"qcms-admin": patch
---

The builder's concurrent-edit warning is said once and then dismissed for good (Code Owner,
2026-08-26).

"Autosave replaces the stored draft outright..." is a standing fact about how this app
saves - there is no locking, and the last save wins - so it never changed and it was
permanently occupying four lines above every form. A warning nobody can stop reading is one
everybody stops reading. It now carries a **Got it**, and pressing it is remembered.

**What the trade costs, stated rather than buried:** an operator who dismisses it never sees
it again on that browser, and the person it most protects is the one who has been here long
enough to have dismissed it. `docs/operations.md` is where the fact stays permanently
true; the notice is the prompt, not the documentation.

**A cookie, not `localStorage`.** The reason `lib/appearance.ts` gives, plus a second half
this screen has just been fixed for: `localStorage` is unreachable during SSR, so a notice
gated on it can only be corrected after hydration - either it flashes up and vanishes for
someone who dismissed it, or it arrives a frame late and pushes the screen down, which is a
layout shift. On the request, the server knows before it renders. Measured: 2693px of
column on a first visit, 2562px once dismissed, and 2562px on the next load rather than
2693px settling to 2562px.

The preference is unsigned and written from the browser, which is safe in one direction
only and deliberately so: every value other than the one the dismiss control writes means
"show the warning", so a forged, truncated or half-cleared cookie cannot suppress a warning
about silent data loss. `lib/builder-notice.test.ts` pins that direction.

Unrelated but asked in the same breath: there is still no manual save on the builder, by
design. The builder autosaves and the question editor is a plain form with a Save button;
that dichotomy is design-language element 7, `plan/admin-design-contracts.md` §6 and
`plan/admin-ux-audit.md` §4.6, and `components/save-model.tsx` exists to make each screen
say which of the two it is.
