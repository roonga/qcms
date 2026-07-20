---
"@qcms/db": minor
---

Add the operational Drizzle schema, the package-owned append-only migration
history, and the Testcontainers test harness (`withTestDb`, `startTestDb`).

The schema covers questions/question_versions, forms/form_drafts/form_versions,
sessions, secure_links, the append-only answers ledger, submissions, erasure
tombstones, the transactional outbox, and the better-auth tables. Database-level
`BEFORE UPDATE` triggers enforce the append-only answer ledger (I5) and the
immutability of published question definitions and form versions (I1); the
one-open-draft-per-form invariant is enforced by the `form_drafts` primary key.
