---
"@roonga/qcms-ui": patch
---

Make Enter continue on a no-JS repeating step instead of removing or adding an instance
(local UX list P3).

Without scripting, Enter in a text, number or date field presses the form's default button,
which HTML defines as the first submit button in tree order. Native submit mode appends the
real Continue (or the readiness-labelled Submit) last, after every `__qop` Remove and the
group's Add, so on a repeating step Enter pressed Vehicle 1's Remove or the Add.

`withNativeSubmit` now prepends a hidden copy of the submit control as the root Form's first
child whenever the tree carries a `RepeatGroup` or `RepeatTable`. It is built from the same
props, so it carries the same label and `formaction`, and like the real control it has no
`name` or `formnovalidate`: a post it submits is the ordinary Continue post, browser
validation included. It is `aria-hidden`, `tabindex="-1"` and clipped to 1px, and carries
`data-qcms-implicit-submit` so a host's own selectors can exclude it. A step with no
repeating group, and the scripted path, render exactly as before.
