---
"@qcms/db": patch
---

The dead-letter queue no longer lists deliveries whose event payload has been redacted (issue #433).

`listDeadLetterDeliveries` adds `outbox.payload_redacted_at is null` beside the
`webhook_deliveries.cancelled_at is null` filter task 059 already applies. The queue is a
worklist: every row on it is being offered back for redelivery, and an event whose
`answers` have been removed can never be sent again - `redeliveryRefusalFor` refuses it
and a cancelled row with the same shape, one line apart. Listing it invited the exact
click the redeliver endpoint then answers with a 409, so each aged-out row cost an
operator one pointless Redeliver to discover.

Issue #329's retention sweep is what makes this worth landing now rather than leaving as
housekeeping: before it, redacted rows came only from erasure, and after it "every event
past the redelivery window" is eventually every event.

Excluded from the worklist, not hidden: the delivery dashboard
(`listRecentDeliveries`) still shows the row, which is where "what happened to that
delivery" is answered. That is the same treatment cancellation gets, deliberately, rather
than a second convention for the same "a row that can never be sent still looks
actionable" problem.

`patch` rather than `minor`: no exported name is added or removed, no signature changes,
and there is no migration. What changes is which rows one existing read returns, and every
row it stops returning is one the redelivery endpoint already refused - so an adopter's
code paths are unchanged and only the operator's list gets shorter.
