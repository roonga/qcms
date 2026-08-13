---
"@qcms/db": major
---

Scope the destructive delivery and erasure query helpers by form (issue #305).

`redeliver`, `erase` and `unflag` acted on a client-supplied id with no ownership
or form-scope check. The ownership chains existed but nothing filtered on them,
so an id was enough to reach a row regardless of which form it belonged to.

Every query a client-supplied id reaches now takes the form as a parameter and
puts it in the `where` clause, so a cross-form row is one the statement never
matches rather than one a caller compares after the fact:

- `eraseSession(exec, formId, sessionId, reason)` scopes **both** its lookups.
  Scoping only the session read would let an already-erased session of another
  form return its tombstone from the idempotency step and reveal that it exists.
- `resetDeliveryForRedelivery(exec, formId, id, now?)` and
  `redeliveryRefusalFor(exec, formId, deliveryId)` filter through
  `webhooks.form_id`, the chain `listRecentDeliveries` already reads. Both need
  it: the refusal check runs first, so unscoped it would answer "not
  redeliverable" for another form's cancelled delivery where an unknown id
  answers "not found".
- `getSessionInForm(exec, formId, sessionId)` is new: the scoped counterpart to
  `getSession`, for operations acting on a session a caller named by id.
- `DeadLetterDelivery` (and `DeliveryView`, which extends it) now carries
  `formId`. The dead-letter worklist is cross-form by design, so a row has to
  name its own form for a form-scoped redelivery call to be constructible from
  the list.

**Breaking:** the three changed helpers take `formId` as their second argument.
Callers that held only an id must now establish which form they are acting
within, which is the point: there was previously no way for them to say.
