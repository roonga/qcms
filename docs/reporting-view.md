# Reporting view - the qcms SQL contract

**Package:** `@roonga/qcms-db` · **Since:** 0.x (task 015) · **Stability:** versioned (see
[Stability promise](#stability-promise))

The reporting schema is qcms's **pull-integration path at launch** - a documented,
read-only SQL surface for BI/ETL/warehouse consumers, shipping in place of the deferred
`/api/v1` (ARCHITECTURE §4.3, §5.3). Because downstream tools bind to its shape, this schema
is **versioned documentation, not an implementation detail**: it changes only under the rules
below.

It is created by the baseline migration as two views under a dedicated Postgres schema
**per environment**, `reporting_<env>` (ADR-40, Q10). The view bodies come from the one
generator in `packages/db/src/reporting-views.ts` (task 075), called with this
environment's `reporting_<env>` and `data_<env>`, which is what lets the same two views
exist under N schema names without a copy of their SQL per name:

- **`reporting_<env>.responses`** - one row per submitted response, answers in a wide JSONB column.
- **`reporting_<env>.answers_flat`** - the same data unpivoted to long format, one row per answer.

Since task 067 each schema also holds **a view set per workspace** beside those two (Q26):
`reporting_prod.home_responses`, `reporting_prod.home_answers_flat` and a pair for every
other workspace, each a filtered projection of the pair above and each granted to its own
read-only role. The unprefixed pair is the **application's** and is granted to no consumer;
a workspace's analysts are granted that workspace's pair in that environment and nothing
else. See [Connection guidance](#connection-guidance).

**One schema per environment, each holding the same view names.** A BI tool connects to one
environment's schema and its queries are otherwise unchanged - the view names, the columns
and their types are identical - so what varies between `reporting_prod` and `reporting_test`
is which rows are in them. That holds of a workspace's set as well as of the unprefixed
pair: `home_responses` means the same thing in both schemas. A fresh database is created
with the two environments; the environment command creates a `reporting_<env>` for every
environment added later, **with every existing workspace's view set already in it**.

The single `reporting` schema this document described before ADR-40 is **replaced** rather
than kept beside them, which green field (Q22) makes free. A consumer bound to
`reporting_<env>.responses` re-points at `reporting_prod.responses`; nothing else about their
query changes.

Both exclude **in-progress**, **expired**, and **erased** sessions **by construction** (see
[Row inclusion](#row-inclusion)).

**The DDL is generated, not literal.** Both view bodies come from `reportingViewStatements()`
in `packages/db/src/reporting-views.ts`, which takes its schema names as arguments; migration
0025's body is that function's output, and a unit test fails if the two fall out of step. The
reason is ADR-40: the data plane becomes a schema per environment and the view set goes with
it (`reporting_<env>`), and since task 067 a set per workspace inside each of those (Q26),
so the same DDL has to be creatable more than once under more than one name. A workspace's
pair comes from `workspaceReportingViewStatements()` in the same module, which projects the
unprefixed pair rather than restating it, so there is one copy of the row-inclusion rule
however many sets exist. The documented column lists below are
`reportingViewColumns` in that module, which the drift test compares the live catalogue
against.

---

## `reporting_<env>.responses`

One row per **submitted** session.

| Column         | Type               | Semantics                                                                                                                                 |
| -------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `session_id`   | `text`             | The response's session id (`ses_…`). Stable, never reused (R6).                                                                           |
| `form_id`      | `text`             | The form the session answered (`frm_…`).                                                                                                  |
| `form_version` | `integer`          | The **pinned** published version the session ran on (I4 - a session never migrates versions).                                             |
| `submitted_at` | `timestamptz`      | When the submission lock was written (the audit instant, I6/I9).                                                                          |
| `access_mode`  | `access_mode` enum | How the respondent reached the form: `anonymous` or `secure_link`.                                                                        |
| `answers`      | `jsonb`            | The locked answer set as an object **keyed by `questionId`**, values in canonical encoding, plus one key per **repeating group** (below). |

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

### Repeating groups (task 075, ADR-42)

A **repeating group** is answered once per instance, so one `questionId` can hold several
answers in one response. Those answers are **not** keyed by `questionId` at the top level -
they would collide. Instead `answers` gains **one key per `groupId`**, holding an **ordered
array** of instance objects. Each instance object carries its own `instance_id` (`ins_…`) plus
one key per member question it answered:

```json
{
  "answers": {
    "q_booking_ref": "ABC123",
    "grp_passengers": [
      { "instance_id": "ins_7k2", "q_name": "Ada Lovelace", "q_meal": ["opt_vegan"] },
      { "instance_id": "ins_9q4", "q_name": "Grace Hopper", "q_meal": ["opt_halal"] }
    ]
  }
}
```

Five properties a consumer can rely on:

- **A form with no repeating group produces a byte-identical `answers` object.** The change is
  additive in fact, not only in principle, and an integration test asserts the exact bytes.
- **Array order is roster order** - the order the respondent's instances were minted in, with
  removed instances absent. It is the order the submission froze, not a second derivation.
- **The array holds every instance that was live and SHOWN, answered or not**, so
  `jsonb_array_length(answers -> '<groupId>')` is the count of those. An instance a respondent
  added and left blank appears as an object carrying only its `instance_id`, which is what
  keeps the long CSV shape's `instance_ordinal` from shifting past a blank one. The list comes
  from the submission's own flow state rather than from its answers, and "shown" is the exact
  word: an instance **all** of whose member questions are hidden by a rule has no visible
  entry, so it is absent here as its answers would be (I6), and the ordinals of the instances
  after it close up. A group with one unconditional member question cannot reach that state.
- **Only a group key holds an array of objects.** A `multiChoice` answer is also a JSON array,
  but of option id strings, which is how `answers_flat` tells the two apart.
- **A question outside every group never appears inside an instance object**, and a member
  question of a group never appears at the top level.

Before 075 this view aggregated with `jsonb_object_agg(… ->> 'questionId', … -> 'value')`,
which **silently kept one** of two answers for the same `questionId` - no error and no
warning. Any deployment that ran a repeating group against the 0003 views lost repeated
answers from reporting and from export; 0025 is what closes that.

---

## `reporting_<env>.answers_flat`

The long-format projection of `reporting_<env>.responses` - one row per **(submitted session,
questionId, instanceId)**. Derived directly from `reporting_<env>.responses`, so it inherits its row
inclusion exactly (submitted-only, non-erased); there is no second exclusion rule to keep in
sync.

| Column         | Type          | Semantics                                                                                    |
| -------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `session_id`   | `text`        | As in `reporting_<env>.responses`.                                                           |
| `form_id`      | `text`        | As in `reporting_<env>.responses`.                                                           |
| `form_version` | `integer`     | As in `reporting_<env>.responses`.                                                           |
| `submitted_at` | `timestamptz` | As in `reporting_<env>.responses`.                                                           |
| `question_id`  | `text`        | The answered question (`q_…`).                                                               |
| `value`        | `jsonb`       | That question's canonical answer value (see encodings below).                                |
| `instance_id`  | `text`        | The repeating-group instance (`ins_…`) the answer belongs to, or `NULL` outside every group. |

For a multi-choice question `value` is a JSONB array of option ids - one flat row still holds
the whole selection (the row grain is the question, not the individual option).

**`instance_id` was appended in task 075** and is the long projection's half of repeating
groups (ADR-42). The grain is now `(session, questionId, instanceId)`: a question answered in
three instances of one group is three rows, told apart by `instance_id`, and every question
outside a group is one row with `instance_id IS NULL`. `GROUP BY session_id, question_id`
without `instance_id` therefore aggregates across instances, which is sometimes what a
consumer wants and is never what it used to mean.

Appending a column is a **minor** release under the [stability promise](#stability-promise): a
consumer selecting explicit columns is unaffected, and a consumer selecting `*` keeps every
column it had in the position it had.

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

In `reporting_<env>.responses.answers` each value appears under its `questionId` key, or under that
key inside its instance object when the question sits in a repeating group; in
`reporting_<env>.answers_flat.value` it is the row's `value` column, with `instance_id` naming the
instance. The encodings themselves are unchanged by repetition: a question does not know that
it is repeated (ADR-42).

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

**Use a read-only role, and grant it one workspace in one environment.** The reporting
surface is a read path, and since task 067 it is granted per **(workspace, environment)**
pair (Q26, ADR-40's reporting Note, ADR-41): a workspace's analysts are granted exactly
their workspace's views in exactly their environment and nothing else. A consumer who
should see two workspaces, or two environments, gets two roles - deliberately, so "which
responses may this tool read" is a question an operator answers rather than a default.

This is the one place in QCMS where the authorisation model is expressed in **database
grants** rather than in an API check, and the reason is in the threat: a reporting
consumer connects with psql or a BI tool and writes their own SQL, so there is no handler
to put a check in. What holds the boundary is a role that was never granted the thing it
must not read.

### 1. Create the role, as an operator

```sql
-- One-time, as a superuser or the database owner - a role that may create roles.
-- Replace the password with a value from your secret store; never commit a real one.
-- The name is `qcms_reporting_<environment>_<workspace slug>`.
CREATE ROLE qcms_reporting_prod_home LOGIN PASSWORD '<from-secret-store>';
```

### 2. Reconcile the views and the grants, as the migration role

```
DATABASE_URL=postgres://qcms_migrate:...@host:5432/qcms \
  pnpm qcms:environment reporting
```

That creates or replaces one view set per (workspace, environment) pair and grants each
pair's role `USAGE` on its own `reporting_<env>` and `SELECT` on **exactly its own two
views**. It is idempotent, so **run it after creating a workspace** - the grants are
guarded on their role existing, so a pair whose role you have not created yet simply gets
its views, and the command's output says which roles are missing.

Creating a view is DDL and no application role holds any (SEC-10), which is why this is a
command under the migration credential rather than something `POST /admin/workspaces`
does. It is the sibling of "after creating an environment, restart the API" (Q59): the
operator is already at a shell with the migration credential.

The one-pair form creates the role for you, if you would rather not write the SQL above:

```
DATABASE_URL=... pnpm qcms:environment reporting \
  --workspace home --environment prod --password "$HOME_PROD_REPORTING_PASSWORD"
```

### What the role may and may not read

| Object                                                                 | This role                             |
| ---------------------------------------------------------------------- | ------------------------------------- |
| `reporting_prod.home_responses`, `home_answers_flat`                   | `SELECT`                              |
| `reporting_prod` (the schema)                                          | `USAGE`                               |
| `reporting_prod.vehicle_responses` and every other workspace's set     | nothing                               |
| `reporting_prod.responses`, `reporting_prod.answers_flat` (unfiltered) | nothing                               |
| `reporting_test` and every other environment's schema                  | nothing, so its views are unreachable |
| `control`, every `data_<env>`, `public`                                | nothing                               |

The last two rows of that table are the ones worth reading twice.

**There is no `GRANT SELECT ON ALL TABLES IN SCHEMA`, and there must not be.** That was the
shape of this recipe while each schema held one view set, and it is exactly the form that
would hand a workspace's analysts every **other** workspace's views the moment a second set
appeared. The grant names the two views.

**There is no `ALTER DEFAULT PRIVILEGES` either.** It was in this recipe for a good reason -
a migration that reshapes a view drops and recreates it, and a dropped view takes its grants
with it - and that reason does not survive a view set per workspace: a default privilege is
keyed on (role, schema, object type) with no per-object filter, so it would grant every view
created in that schema afterwards, which is the leak the row above refuses. The
reconciliation in step 2 is what replaces it, and it is why that step is a command an
operator re-runs rather than a privilege that fires on its own.

**The unfiltered `responses` and `answers_flat` are the application's, not a consumer's**
(Q52). Each `qcms_app_<env>` holds `USAGE` on its own `reporting_<env>` and `SELECT` on that
schema's views, because the staff response-reading path reads them on the environment's own
pool; that grant is written by the baseline and the environment command. A consumer role is
granted its workspace's filtered pair and never those, which is what makes a workspace a
confidentiality boundary here as well as in the API.

**A workspace's views are a filtered projection of that pair**, not a second copy of their
SQL: `home_responses` selects from `reporting_prod.responses` and adds one predicate on
`control.forms.workspace_id`. So the erasure anti-join and the submitted-only rule of [Row
inclusion](#row-inclusion) live in exactly one view body and reach every workspace. The
predicate reads the workspace **id**, which is stable; the view **name** carries the slug,
which is what a connection string and an analyst's query hold.

**The dev-tools viewer role `qcms_ro` is a different role in a different file.** It holds
`pg_read_all_data` and is defined in `docker-compose.dev-tools.yml`; nothing here touches
it, and the two are easy to confuse.

**An archived workspace keeps its views.** An archive is terminal (Q66) and says nothing
about destroying the record of what the workspace held, and these views are what a BI tool
is connected to - so the reconciliation reports an archived pair rather than removing it.
Removing a consumer's access is a `REVOKE` or a `DROP ROLE`, which is an operator act with
its own name.

**What an upgrade that reshapes a view costs you.** A migration that reshapes
`reporting_<env>.responses` drops and recreates it, and a dropped view takes its grants with
it - but a workspace's views are not grants on that view, they are objects of their own, and
`CREATE OR REPLACE` leaves their grants in place. So the answer after any upgrade is the same
as the answer after creating a workspace: **run `pnpm qcms:environment reporting`**, which is
idempotent and re-applies whatever the upgrade removed. One step, in one place, rather than a
privilege that has to have been set up correctly a year earlier.

---

## Stability promise

This schema is **versioned via `@roonga/qcms-db`** (Changesets, from Stage 5):

- **Additive changes are minor.** New views, or new columns appended to an existing view, ship
  in a minor `@roonga/qcms-db` release. Consumers selecting explicit columns are unaffected.
- **Renames and removals are major.** Renaming or dropping a view or a column, or changing a
  column's type or an answer's canonical encoding, is a breaking change and requires a **major**
  `@roonga/qcms-db` version.
- Column **order** is not part of the promise - select columns by name.

A drift test (`reporting-retention.integration.test.ts`) asserts the live view column lists
against the tables documented here, so this document can never silently fall out of step with
the migration. Since task 075 it reads those lists from `reportingViewColumns` in
`packages/db/src/reporting-views.ts` rather than from a literal of its own, because the view
set stops being singular under ADR-40 and a per-schema literal is a per-schema thing to forget.

---

## Retention (companion policy)

Retention lives beside reporting in `@roonga/qcms-db` (task 015) and shapes what the views can ever
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

**Scheduling is the API's job (task 017), not this package's** - `@roonga/qcms-db` provides the
operations; the retention scheduler in the API process invokes them.

### Default session TTLs

| Access mode   | Default TTL                | Notes                                                               |
| ------------- | -------------------------- | ------------------------------------------------------------------- |
| `anonymous`   | **24 hours** from creation | `DEFAULT_ANONYMOUS_SESSION_TTL_MS`; tunable via `SessionTtlConfig`. |
| `secure_link` | **= the link's expiry**    | The session expires with its link (SEC-2), never after it.          |

`sessionExpiresAt({ accessMode, now, linkExpiresAt?, config? })` computes a new session's
`expiresAt` from this policy - the single place the launch TTL numbers live, so the API's
start-session slice does not hardcode them.
