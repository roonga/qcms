# Reporting view - the qcms SQL contract

**Package:** `@qcms/db` · **Since:** 0.x (task 015) · **Stability:** versioned (see
[Stability promise](#stability-promise))

The reporting schema is qcms's **pull-integration path at launch** - a documented,
read-only SQL surface for BI/ETL/warehouse consumers, shipping in place of the deferred
`/api/v1` (ARCHITECTURE §4.3, §5.3). Because downstream tools bind to its shape, this schema
is **versioned documentation, not an implementation detail**: it changes only under the rules
below.

It is created by migration `0003_reporting_view.sql` as two views under a dedicated
`reporting` Postgres schema:

- **`reporting.responses`** - one row per submitted response, answers in a wide JSONB column.
- **`reporting.answers_flat`** - the same data unpivoted to long format, one row per answer.

Both exclude **in-progress**, **expired**, and **erased** sessions **by construction** (see
[Row inclusion](#row-inclusion)).

---

## `reporting.responses`

One row per **submitted** session.

| Column         | Type               | Semantics                                                                                     |
| -------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| `session_id`   | `text`             | The response's session id (`ses_…`). Stable, never reused (R6).                               |
| `form_id`      | `text`             | The form the session answered (`frm_…`).                                                       |
| `form_version` | `integer`          | The **pinned** published version the session ran on (I4 - a session never migrates versions). |
| `submitted_at` | `timestamptz`      | When the submission lock was written (the audit instant, I6/I9).                              |
| `access_mode`  | `access_mode` enum | How the respondent reached the form: `anonymous` or `secure_link`.                            |
| `answers`      | `jsonb`            | The locked answer set as an object **keyed by `questionId`**, values in canonical encoding.   |

`answers` contains only the **visible** questions' answers the submission locked (I6 - hidden
questions' answers stay in the append-only ledger and never enter a submission). A submission
with no visible answers yields `{}`.

### Example

```json
{
  "session_id": "ses_abc",
  "form_id": "frm_intake",
  "form_version": 3,
  "submitted_at": "2026-01-02T03:04:05.000Z",
  "access_mode": "anonymous",
  "answers": {
    "q_full_name": "Ada Lovelace",
    "q_age": 41,
    "q_subscribed": true,
    "q_interests": ["opt_math", "opt_engines"]
  }
}
```

---

## `reporting.answers_flat`

The long-format projection of `reporting.responses` - one row per **(submitted session,
questionId, value)**. Derived directly from `reporting.responses`, so it inherits its row
inclusion exactly (submitted-only, non-erased); there is no second exclusion rule to keep in
sync.

| Column         | Type          | Semantics                                                     |
| -------------- | ------------- | ------------------------------------------------------------- |
| `session_id`   | `text`        | As in `reporting.responses`.                                  |
| `form_id`      | `text`        | As in `reporting.responses`.                                  |
| `form_version` | `integer`     | As in `reporting.responses`.                                  |
| `submitted_at` | `timestamptz` | As in `reporting.responses`.                                  |
| `question_id`  | `text`        | The answered question (`q_…`). One row per question.          |
| `value`        | `jsonb`       | That question's canonical answer value (see encodings below). |

For a multi-choice question `value` is a JSONB array of option ids - one flat row still holds
the whole selection (the row grain is the question, not the individual option).

---

## Canonical value encodings

Answer values are stored and reported in the canonical encodings frozen in task 002
(`DOMAIN_SCHEMA.md` §2.4) - the same encodings the kernel hashes into the content lock, so a
reporting value is byte-identical to what was submitted.

| Question type            | JSON encoding of `value`                                  |
| ------------------------ | --------------------------------------------------------- |
| `shortText` / `longText` | JSON string, NFC-normalized                               |
| `number`                 | JSON number, finite IEEE double                           |
| `date`                   | JSON string, timezone-less ISO `YYYY-MM-DD`               |
| `boolean`                | JSON `true` / `false`                                     |
| `singleChoice`           | JSON string, the selected `optionId` (`opt_…`)            |
| `multiChoice`            | JSON array of `optionId`s, deduplicated, order-preserving |

In `reporting.responses.answers` each value appears under its `questionId` key; in
`reporting.answers_flat.value` it is the row's `value` column.

---

## Row inclusion

A row appears **only** when its session is `submitted` **and** is not erased:

- **Submitted only.** The view joins `submissions` to `sessions` and requires
  `sessions.status = 'submitted'`. `created`, `in_progress`, and `expired` sessions never
  appear - a response exists for reporting only once its answer set is locked.
- **Erased excluded - by the tombstone anti-join.** The view `LEFT JOIN`s
  `erasure_tombstones` on `session_id` and keeps only rows with **no** tombstone. This is the
  chosen exclusion mechanism: it is explicit, and it holds **independently** of erasure's
  delete path (ADR-17, task 016). Erasure additionally hard-deletes the `submissions` row, so
  after 016 an erased response is excluded twice over (no submission row **and** a tombstone) -
  defense in depth, but the tombstone anti-join alone is the guarantee this contract makes.

Because the exclusion is in the view definition, no consumer query can accidentally read
non-submitted or erased data.

---

## Connection guidance

**Use a read-only role.** The reporting surface is a read path; grant consumers `SELECT` on
the `reporting` schema and nothing else. A sample least-privilege grant:

```sql
-- One-time, as a superuser/owner. Replace the password with a value from your
-- secret store - never commit a real credential.
CREATE ROLE qcms_reporting LOGIN PASSWORD '<from-secret-store>';

-- Read-only on the reporting views only; no access to the operational tables.
GRANT USAGE ON SCHEMA reporting TO qcms_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO qcms_reporting;

-- Ensure future reporting views are readable too (additive changes only).
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON TABLES TO qcms_reporting;
```

The role deliberately gets **no** privileges on the `public` schema, so a reporting consumer
can never read raw ledger answers, tokens, or auth tables - only the curated, erasure-safe
views. Point BI/ETL tools at this role.

---

## Stability promise

This schema is **versioned via `@qcms/db`** (Changesets, from Stage 5):

- **Additive changes are minor.** New views, or new columns appended to an existing view, ship
  in a minor `@qcms/db` release. Consumers selecting explicit columns are unaffected.
- **Renames and removals are major.** Renaming or dropping a view or a column, or changing a
  column's type or an answer's canonical encoding, is a breaking change and requires a **major**
  `@qcms/db` version.
- Column **order** is not part of the promise - select columns by name.

A drift test (`reporting-retention.integration.test.ts`) asserts the live view column lists
against the tables documented here, so this document can never silently fall out of step with
the migration.

---

## Retention (companion policy)

Retention lives beside reporting in `@qcms/db` (task 015) and shapes what the views can ever
show:

- **`sweepExpiredSessions(exec, now)`** transitions abandoned `created`/`in_progress` sessions
  past their `expiresAt` to `expired`, keeping the ledger row (audit). A session is valid
  **strictly before** `expiresAt`; at the exact instant `now === expiresAt` it is already
  expired (consistent with the secure-link token convention, task 010). Expired sessions are
  not submitted, so they never enter the reporting views.
- **`purgeExpired(exec, olderThan)`** is optional hard cleanup: it permanently removes the
  ledger rows (session **and** its append-only answers) for sessions that **expired and were
  never submitted**, whose `expiresAt` is strictly before `olderThan`. It never touches
  submitted content or erased sessions (their session row is already gone).

**Scheduling is the API's job (task 017), not this package's** - `@qcms/db` provides the
operations; the retention scheduler in the API process invokes them.

### Default session TTLs

| Access mode   | Default TTL                | Notes                                                              |
| ------------- | -------------------------- | ------------------------------------------------------------------ |
| `anonymous`   | **24 hours** from creation | `DEFAULT_ANONYMOUS_SESSION_TTL_MS`; tunable via `SessionTtlConfig`. |
| `secure_link` | **= the link's expiry**    | The session expires with its link (SEC-2), never after it.         |

`sessionExpiresAt({ accessMode, now, linkExpiresAt?, config? })` computes a new session's
`expiresAt` from this policy - the single place the launch TTL numbers live, so the API's
start-session slice does not hardcode them.
