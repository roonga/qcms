---
"create-qcms-app": patch
---

Carry the live-roster derivation into the scaffolded API (task 072, ADR-42).

A scaffolded app mirrors `apps/api`, so it gains
`src/features/responses/roster.ts` with the rest of the instance ledger: the
derivation that turns the append-only `answer_group_instances` rows into the live
roster the evaluator is handed, per count source, and the mint, add and remove
helpers beside it. Nothing existing changes, and no route calls it yet; the
serving loop that does is task 073.
