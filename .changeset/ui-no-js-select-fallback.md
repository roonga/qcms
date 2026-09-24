---
"@roonga/qcms-ui": minor
---

Render a real `<select>` for a single-choice question when the form is submitted
natively, so a respondent without scripting can answer it (issue #988).

A `singleChoice` question compiles to a `Select` above seven options
(`SINGLE_CHOICE_SELECT_THRESHOLD`) and to a `RadioGroup` at or below it. The
vendored `Select` does put a real `<select>` with the real options on the page
under the question's own name, and puts it inside a clipped container that is
`aria-hidden="true"` with `tabindex="-1"`, as an autofill and validation mirror,
behind a visible `<button aria-haspopup="listbox">` only JavaScript can open. So
with scripting off the question could be neither seen nor operated, and a
required one made the browser try to report validity on an unfocusable control
and abandon the whole step's submission.

Native-submit mode now renders `NativeSelectField`: one real, visible, focusable,
labelled `<select>` under the question's own name, carrying the compiled options
in authored order, with the description and error slot wired through
`aria-describedby`. The first option is an empty-valued placeholder, which keeps
the browser's own `required` check working (HTML can express "one option chosen"
for a select, so the 2026-09-13 ruling on issue #920 applies unchanged) and gives
an optional single-choice question a clear gesture it has on no other path: the
empty value posts beside the question's `__qa__` marker and decodes to the same
ADR-33 retraction every other cleared field produces.

The scripted rendering is unchanged, no vendored byte moved (ADR-22), and the BFF
decoder needed no change - the chosen OptionId is the same `string` the scripted
path posts. `theme-components.css` now names `select` in its text-entry box rule,
its `prefers-contrast: more` edge rule and its forced-colors edge rule, so the
fallback's box comes from the same spacing, radius and border tokens as every
other control instead of from the browser's default.
