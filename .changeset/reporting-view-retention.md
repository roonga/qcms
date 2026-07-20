---
"@qcms/db": minor
---

Add the reporting SQL contract and the retention sweep (task 015).

Migration `0003` creates a read-only `reporting` schema - the documented pull-integration
path shipping at launch in place of `/api/v1`:

- `reporting.responses` - one row per **submitted** session (`session_id`, `form_id`,
  `form_version`, `submitted_at`, `access_mode`, and the locked answers as JSONB keyed by
  `questionId`). Non-submitted sessions and **erased** sessions are excluded by construction:
  a `LEFT JOIN` anti-join on `erasure_tombstones` removes erased responses independently of
  erasure's own delete path (ADR-17, task 016).
- `reporting.answers_flat` - the long-format projection, one row per (submitted session,
  `question_id`, canonical `value`), derived from `reporting.responses` so it inherits the
  same row inclusion.

The versioned contract is documented in `docs/reporting-view.md` (column semantics, canonical
value encodings per §2.4, additive-only stability promise, and a read-only-role connection
grant). A drift test asserts the live view columns against the doc.

Retention helpers (the API's scheduler, task 017, invokes these - scheduling is not in this
package):

- `sweepExpiredSessions(exec, now)` - transitions abandoned `created`/`in_progress` sessions
  past `expiresAt` to `expired`, keeping the ledger row. A session is valid strictly before
  `expiresAt` (consistent with the token convention, task 010); submitted sessions are never
  swept; re-running is idempotent.
- `purgeExpired(exec, olderThan)` - optional hard cleanup that removes the ledger rows
  (session + append-only answers) for expired-never-submitted sessions strictly older than the
  horizon; never touches submitted or erased sessions.
- `sessionExpiresAt(...)` plus `DEFAULT_ANONYMOUS_SESSION_TTL_MS` (24h) and `SessionTtlConfig`
  - the launch session-TTL policy (anonymous 24h; secure-link = link expiry) in one place.
