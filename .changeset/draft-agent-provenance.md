---
"@roonga/qcms-db": minor
---

Record on a form draft whether it carries agent-assisted changes (task 041,
ADR-25). `form_drafts` gains an `agent_assisted` boolean column (migration
`0019_draft_agent_provenance`, default `false`), and `upsertDraft` accepts an
optional `agentAssisted` flag.

The flag is **sticky**: the upsert's conflict branch ORs the incoming value with
the stored one, so an ordinary later save cannot quietly erase the provenance of
a draft that accepted an agent proposal before the human publishes it. Discarding
the draft clears it, because that removes the row.

Provenance, not permission: nothing in the engine branches on this value. It is
what the builder header and the publish confirmation show, so the person
publishing knows what they are signing.
