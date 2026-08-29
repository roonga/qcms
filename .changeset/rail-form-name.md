---
"qcms-admin": minor
---

The rail calls a form what its author called it (Code Owner, 2026-08-26).

Its first row showed the slug - how the form is ADDRESSED, and what appears in every URL -
where the title is what a person recognises. It shows the title now, and falls back to the
slug for a form nobody has named yet, which is a real state rather than an empty row. One
`formDisplayName` for both places the rail says this name, the row and the collapsed
summary, because two would eventually disagree about what a form is called.

**The form's row truncates; its steps do not.** A title is prose an author chose and can be
any length, and that row is the tree's root: wrapped to four lines it would push every step
out of sight before the reader had seen one. A step row wraps instead, deliberately, and
`e2e/rail.pw.ts` pins that - a step's title is what the reader is choosing between, where
the form's is what they already know they are in. Only the paint is cut: the element's text
stays complete, so it is what a screen reader announces. Measured with a 69-character
title: the row holds 40px and reports itself clipped, and the step row beside it is
unchanged.

The rail's first row also gets the breathing room the summary above it used to provide. It
began flush against the top bar once that summary was hidden at sidebar widths.
