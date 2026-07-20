---
"@qcms/db": minor
---

Add a nullable `flaggedReason` column to `submissions` (migration `0005`) and
an optional `flaggedReason` argument to `insertSubmission`. The submit slice
(020) sets it when an anti-abuse signal fires (honeypot, too-fast): the
submission is stored and the session marked submitted, but a flagged row is
withheld from webhook delivery - the `response.submitted` outbox event is not
enqueued. `NULL` means a clean submission; the reason string is surfaced to the
admin review + unflag path (023).
