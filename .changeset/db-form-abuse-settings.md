---
"@qcms/db": minor
---

Add per-form abuse-control settings to the `forms` table (migration `0008`):
`challenge_required` (boolean, default `false`) and `min_submit_ms` (integer,
nullable). Both are operational domain config on the mutable identity row (like
`status`), not part of the immutable published definition and not deployment
flags (ADR-24). `createForm` gains optional `challengeRequired` / `minSubmitMs`
arguments; both flow through the existing `forms` reads (`getFormBySlug`,
`getForm`). The API (task 026) reads `challengeRequired` at start-session and
`minSubmitMs` as a per-form override of the min-time floor at submit.
