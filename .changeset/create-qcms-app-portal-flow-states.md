---
"create-qcms-app": patch
---

Fix four respondent-flow states in the scaffolded portal's hydrated step flow (local UX list
P2, P4, P7, P9).

An expired or already-submitted session now reloads onto the page's own expired or completion
screen instead of saying "We could not reach the server" for ever. The first Continue or Back
pressed while the previous field's answer is still saving is no longer swallowed: the buttons
stay operable, the press runs once the save lands, and a second press while one is pending is
refused, so nothing advances or submits twice. Continue and Submit stop at a field showing a
"not valid" message, and the error summary lists that refusal the way the no-JS path does.
The "could not reach the server" notice now sits beside the actions with a Try again, and it
and the repeating-group count refusal clear once a later round trip makes them untrue.
