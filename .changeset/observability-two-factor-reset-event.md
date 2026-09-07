---
"@roonga/qcms-observability": minor
---

Admit `admin two-factor reset` to the SEC-13 export vocabulary (issue #432).

It is the one signal that an administrator's second factor was removed out of band. The
command that does it has no HTTP surface, so nothing else an observability backend can
see records that it ran, and an operator who wants an alert on "somebody exercised the
recovery path" has this event and nothing else.

It carries no attributes at all, which is its whole privacy argument and not an accident
of the call site: the facts worth knowing about a reset are an email address and a user
id, and SEC-13 names direct identifiers as never belonging in an exported signal. They go
on the `two_factor_resets` row instead, in the adopter's own database, under the controls
that reach it.
