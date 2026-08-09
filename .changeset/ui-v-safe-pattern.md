---
"@roonga/qcms-ui": patch
---

`A2UIStepRenderer` now emits a shortText question's HTML `pattern` attribute only
when that pattern compiles under the browser's regex `v` flag (issue #29).
Browsers validate `pattern` with `v`, whose character-class grammar is stricter
than the `u` semantics a question's validation regex is authored and validated
against, so a stored pattern such as `^[A-Za-z][A-Za-z .,'-]{0,99}$` was rejected
outright: the browser logged "Pattern attribute value ... is not a valid regular
expression" and dropped native client-side validation for that field entirely.

The renderer now normalizes such a pattern where the rewrite is provably
semantics-preserving, escaping only the characters `v` reserves inside a
character class that `u` treats as ordinary literals there, and omits the
attribute when it cannot do so safely. A pattern that already compiles under `v`
is passed through byte-identical, so the `&&` and `--` class-set operators `v`
defines are never disturbed.

Adopters observe the console error and the lost native hint disappear, with no
change to submitted-data behavior: server-side validation remains the sole
validation authority (R2), so a dropped native hint narrows nothing that the API
does not still enforce. The fix is renderer-side by necessity, because stored
A2UI documents are immutable and served forever (R1, ADR-18) and so keep their
original `pattern` string regardless of compiler changes.
