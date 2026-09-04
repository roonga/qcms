---
"@roonga/qcms-db": minor
---

Refuse to reset a redacted outbox event for redelivery, instead of stranding it
(issue #433).

`resetForRedelivery` cleared `delivered_at` and `dead_lettered_at` without looking at
`payload_redacted_at`, and `claimDue` filters _on_ `payload_redacted_at`. So resetting
an event whose answers had been removed left it in the one state nothing recovers
from: reading as pending, claimed by no deliverer, revisited by nothing. Erasure has
been able to produce a redacted event since task 059, and issue #329's retention sweep
widens the population from "sessions someone asked to erase" to "every event past the
redelivery window".

The predicate is now part of the statement (`payload_redacted_at is null` in the
`where`), so such a row matches nothing: it is not updated, not returned, and left
exactly as it was.

`outboxRedeliveryRefusalFor(exec, id)` is the new companion read, and it is
deliberately the same shape as `redeliveryRefusalFor` one level down rather than a
second idiom for the same concept: it returns a reason (`"payloadRedacted"`) when the
event exists and may not be redelivered, and `undefined` both when it may and when it
does not exist, because `resetForRedelivery` is what reports the not-found. A caller
reads the two in order and tells the three outcomes apart:

```ts
if ((await outboxRedeliveryRefusalFor(db, id)) !== undefined) return conflict();
const reset = await resetForRedelivery(db, id);
if (reset === undefined) return notFound();
```

**Behaviour change for an existing export:** `resetForRedelivery` now returns
`undefined` for a redacted event where it previously returned the reset row. A caller
that does not read the refusal helper first therefore reports a not-found rather than
stranding the event, which is the safe direction to be wrong in.
