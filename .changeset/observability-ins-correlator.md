---
"@roonga/qcms-observability": patch
---

Record `ins_` among SEC-13's permitted pseudonymous correlators in the Next span redactor's
contract (task 075).

No behaviour changes and no list moves, which is the point worth writing down: the allowlist
is over attribute **keys** and never inspects a value, so a repeating-group instance id in a
path or an attribute value already travelled untouched, and `lnk_` remains the only branded id
this module rewrites. What must not travel is an instance **label**, which is authored
`LocalizedText`, or an answer value under a qualified field name; both are dropped by the key
allowlist without being inspected, and the portal's unit tests now pin both halves.
