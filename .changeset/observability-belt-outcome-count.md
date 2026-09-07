---
"@roonga/qcms-observability": patch
---

Correct a comment in the OTLP log allowlist: `beltOutcome` now has four members on the
portal rather than three, because the no-JS appearance form's refusal is its own outcome
(`redirect-to-page`, issue #195).

Comment only. The allowlist already carries `beltOutcome` as an attribute name and lists
no values, for the reason the comment beside it gives: every value the belt emits is a
constant chosen from a vocabulary declared in the app, so widening that vocabulary needs
no change here. The count was simply stated and had gone stale.
