---
"@roonga/qcms-observability": minor
---

Classify task 041's three assist log records for the OTLP export vocabulary
(SEC-13). `draft assistant turn` and `draft assistant tool call rejected` join
`SAFE_EVENTS`; `draft assist stream failed` joins `INTENTIONALLY_OPAQUE`.

An unclassified message literal exports as `application.event` with its body
silently dropped, so before this the assist slice's records left the process
unnamed. The two that are now safe are pass-level metrics an operator counts,
and they are safe for the reason `origin.belt.refused` is: each body is a
constant declared at its call site, and every attribute either record sets is
absent from `SAFE_ATTRIBUTES` and is deleted before export. What leaves the
process is the event name and its count, never a value.

That matters most for the refusal record, whose `tool` attribute is a name a
hostile model chose. It does not travel. The name that does is the reason the
record exists: an allowlist refusal is the only trace an attempt to publish,
erase, mint a link or read an answer through the assistant leaves anywhere.

No attribute was added to `SAFE_ATTRIBUTES`, because exporting the counts behind
these names would be a widening of its own and is not needed to close the gap.
