---
"qcms-admin": patch
---

Clear the stored assistant conversation whenever a session ends, not only when the account
menu signs out (issue #1206 follow-up).

The dialogue lives in the tab's `sessionStorage`, and only the account menu's sign-out
cleared it. An expiry, or any other arrival at `/sign-in`, left the previous user's turns in
the tab until the next sign-in overwrote them. The sign-in screen now clears it on arrival,
which is where every ended session lands, since neither the sign-out POST nor an expiry can
reach tab storage itself.

Also corrected: the residual risk of a forged `conversationId` or `visitId` in
`apps/api/src/features/agent/schema.ts`, which claimed such an id "can only add" rows. It
can also skip a stay the same user already has a row for in that environment, as the
feature README states.
