---
"@roonga/qcms-db": minor
---

The roster row records the operation token that wrote it (task 073, ADR-43)

Migration 0024 adds one nullable column, `answer_group_instances.op_token`, and `rosterOpApplied` reads it. It is the one-time roster-operation token the rendered page minted into its Add or Remove button: the API records it with the row it writes, so a replayed post applies nothing and returns the roster as it stands. `addInstances` and `removeInstance` take it as an optional input and `RosterEventRow` carries it.

It is deliberately unconstrained in the database. "At most one row per token" is a cross-row invariant, so the only SQL shapes that express it are a partial UNIQUE index or a third trigger, and either would be a fifth guard on a table ADR-40's amendment counts four for; the Code Owner ruled the roster's own no-duplicates invariant into code for that reason on 2026-09-30 and this one is held the same way, inside the session's advisory lock where the check and the write are one decision. ADR-40 stays at seventeen guards, eight foreign keys and twenty-five per-environment objects.

`answers.instance_id`, added in 0022, now reaches the API: `appendAnswer` and `retractAnswer` are called with it, so a retraction clears one cell of one instance.
