# Releases, promotion and the environment set (task 065)

ADR-40: an environment is a **release state over the one immutable version history**,
never a second copy of it. A version is published once, into `control`, and is shared by
every environment (ADR-18); what varies per environment is which published version is
**released** there. This slice is the second act.

## Routes

| Method | Path                               | Cell (`route-policy.ts`)                            | Notes                                                                                                                                                    |
| ------ | ---------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/forms/{id}/releases`             | `release: create`, environment from body            | Release or promote a published version. Writes one record, copies nothing.                                                                               |
| `GET`  | `/forms/{id}/releases`             | `release: read`                                     | The release history, newest first, each rollback marked. `?environment=`. It is also what "released where" is read from: the newest row per environment. |
| `POST` | `/forms/{id}/release-review`       | `release: read`                                     | What releasing one source into each permitted destination would do. Writes nothing.                                                                      |
| `POST` | `/forms/{id}/release-batch`        | `release: create`, environment **per target**       | One existing version into every named destination, atomically.                                                                                           |
| `GET`  | `/forms/{id}/release-batches/{key}` | `release: read`                                    | The stored result of one confirmation, scoped to the calling account.                                                                                    |
| `GET`  | `/release-workflow`                | `release: read` over the caller's workspaces        | The rules in force per destination, the derived default included.                                                                                        |
| `PUT`  | `/release-workflow`                | `workspace: update`, installation-only, `setting`   | Append the next revision. No grant reaches it.                                                                                                           |
| `GET`  | `/environments`                    | grant-exempt, narrowed to held grants               | The live set, in `position` order, for the Q6 switcher.                                                                                                  |

The combined **publish and release batch** lives in the forms slice
(`POST /forms/{id}/publish-batch`), because it publishes: it shares that slice's validation
and compile, and calls `commitReleaseBatch` here for the rest.

There is **no `GET /releases`**. An earlier draft of this table listed one, for "the
current release per form across forms", and no such route was ever registered. What
reads that question today is the form library (`GET /forms`), whose `status` is the
request environment's, and one form's own history above.

The combined **publish and release** action lives in the forms slice
(`POST /forms/{id}/publish-and-release`), because it publishes: it shares that slice's
validation and compile, and calls `recordRelease` here for the second half. One
transaction covers both.

## The release transaction

`release.ts` is the whole of it, and it is one function because two routes perform it:

1. `insertFormRelease` writes the `control.form_releases` row, its `sequence` assigned by
   a scalar subquery so two concurrent releases into one environment cannot claim the same
   place in the history. The composite primary key is the backstop, and **the loser is
   refused rather than retried**: it violates that key, the handler types the violation as
   a `409 RELEASE_RACED`, and repeating the act is the caller's. There is no automatic
   retry, and there should not be - a release that silently re-ran would write a second
   audit row nobody asked for.
2. `enqueueInEnvironment` writes `form.released` into **that environment's** `outbox`.

Both in **one transaction on the control pool** (Q49), so the event is never observed
without its record. Three facts about the event write are privilege facts rather than
style:

- it is **schema-qualified**, because the control pool's `search_path` is `control` alone
  and one transaction is one connection;
- it has **no `RETURNING`**, because `qcms_app_control` holds `INSERT` on each
  `data_<env>.outbox` and no other privilege of any kind in any data schema, and
  `RETURNING` is a read. Widening that grant is not available: an outbox payload carries
  respondent answers;
- it is **queued and not delivered** (Q55). The deliverer fans out `response.submitted`
  only, so no subscriber sees anything and this is not a change to what a subscriber
  receives. Delivering form events to endpoints would be a separate, later feature with
  its own payload contract.

**Publishing queues nothing** (Q60, task 064). This slice removes nothing there;
`forms.integration.test.ts` asserts by count that a publish still writes no outbox row in
any environment, which is a guard against the enqueue coming back.

## What the respondent path reads

`getReleasedVersion`, not `getLatestPublishedVersion`
(`../responses/start-session/handler.ts`). A new session is pinned to the version released
to **its** environment, so a version released to `test` and not to `prod` is served in
`test` and refused in `prod`. The read runs on the environment pool, which holds `SELECT`
on `control.form_releases` (Q48's six-table read list, granted by that table's own
migration).

**A release never re-pins a session already open** (ADR-07, invariant I4, Q5). Resolution
happens once, at start. Nothing here can move a pin: the control pool holds no privilege
on `sessions` in any environment, and no exported query helper writes `form_version` at
all.

## Rollback

Releasing an earlier version, and there is no second mechanism. Nothing is reverted,
undone or deleted: a new row records it, every prior row stays intact (the database rejects
an UPDATE and a DELETE on this table), and sessions already open stay on the version they
started. The history **marks** such a row as a rollback, derived from the row's predecessor
by `lag(version)` partitioned by environment rather than typed by the administrator,
because "released version 4 after version 7" is the shape an incident review reads.

## What this slice deliberately does not do

- **No copy of a version, in any form.** Promotion is a record; a copy would break R1, R6
  and ADR-18 at once.
- **Ordering is the configured workflow's** (ADR-40's amendment of 2026-10-29). With no
  revision written and both test and prod served, a production candidate needs prior test
  or prod release history. Prod-only deployments still permit a direct release.
- **No approval rule.** `approvedBy` exists from this task and is written by task 070's
  two-person rule for `prod` (Q51). Nothing here enforces who may fill it.
- **No membership check.** The workspace role and its environment scope arrive with tasks
  068 and 069; a check before they exist would be inventing one.
- **No link minting.** The environment on a minted link is the links slice's, where task
  066 made the mint's `environment` a required field (Q19).
- **No authorisation over closing.** Who may close and reopen an environment is task
  067's (Q33): an editor for `dev` and `test`, an approver holding `prod` in scope for
  `prod`. Task 066 built the operation and no role check.

## The environment set

`GET /environments` reads `control.environments`, which is the source of the set, ordered
by `position` (the canonical order of Q42), intersected with the pools this process holds.
It rides this slice because the switcher and the release screens are one feature: the
switcher offers exactly the environments a release can name.

The switcher's **selection** travels the other way, as the `x-qcms-environment` header,
read by `middleware/request-environment.ts` on the admin group alone - so every admin
screen reads its own environment's data and a respondent request cannot name an
environment at all.

## The closed state (task 066, Q18)

The same state carries whether intake is **open** in that environment:
`control.form_releases.closed`, read as the newest row for the (form, environment) pair.
So one read answers both "which version is released here" and "is intake open here",
which is what the respondent path asks on every start.

It sits on this state rather than in a table beside it for a privilege reason as much as a
shape one: an environment role already holds `SELECT` on `form_releases` (Q48's six-table
read list), so the respondent path reads the closed state with no new grant, ADR-40's role
table is unchanged, and the least-privilege suite's expected list stands.

`POST /forms/{id}/close` and `/reopen` (the forms slice) **append** a row carrying the
released version forward with the flag flipped. They inherit this table's properties
rather than needing their own: the history records who closed `prod` and when, nothing can
rewrite it, and a close is never observed as a version change. **A release does not
reopen a closed environment** - it carries the current value forward, because closing is a
deliberate operational act and releasing a version is not a request to resume intake.

## The configurable release workflow (Q85, Q86)

Installation-wide, versioned rule rows in `control.release_workflow_revisions` and
`control.release_workflow_rules`, written over HTTP by the installation claim alone and
read by every `forms.` role. **No row is seeded**: with no revision, `readWorkflow` answers
`defaultWorkflowRules`, which is the derived behaviour of the section below stated as data,
and reports `source: "default"`. An environment a configured revision wrote no row for
constrains nothing.

Three rules per destination, and one exception that is not a rule:

- `requiresPriorReleaseIn` is the environments a committed release of the same version must
  exist in. **Evidence is any committed release row**, read before the transaction's first
  write; a sibling destination in the same confirmation never supplies it.
- **The rollback exception.** A version with any prior release row in the destination itself
  is eligible there whatever the prerequisites say, because moving back to what that
  environment already served is a rollback rather than a promotion. That is why the default
  revision's `prod` rule names `test` alone and the historical prod candidate still
  releases: the rule and the exception together are exactly the earlier behaviour.
- **The two-person rule is not an evidence rule.** `approvalForRelease` runs for every
  production destination, rollback included, and no rule here can switch it off.
- `allowsDraftPublish` and `allowsInBatch` govern the combined publish and the multi-target
  confirmation. `allowsInBatch` may be true for `prod`; the two-person rule and the draft
  refusal still apply per destination.

The refusal code follows the source: `TEST_RELEASE_REQUIRED` on the default revision, which
is what the existing release dialog reads, and `PRIOR_RELEASE_REQUIRED` once a revision is
written. The write validates every name against the served set, refuses a destination that
requires a prior release in itself, refuses a duplicate row and refuses a cycle, and it
creates, renames and drops no environment: that stays the operator command's.

## One confirmation is one transaction (Q89)

`batch.ts` is the whole of it, and it is one function because two routes perform it:
`POST /forms/{id}/release-batch` here and `POST /forms/{id}/publish-batch` in the forms
slice, which passes a `freeze` callback so the snapshot is written inside the same
transaction.

1. `SELECT ... FOR UPDATE` on the `control.forms` row through `lockForm`: one publish or
   release per form at a time. Taken **before** the replay lookup, so two copies of one
   request cannot both find no stored result.
2. `control.release_batches` by `(principal, form, key)`: an equal intent hash replays the
   stored result, a different one is `422`. Only successes are stored, so a refusal leaves
   the key free to retry.
3. Recheck the workflow revision, the draft `revision`, each destination's newest
   `sequence`, the prerequisite evidence and `approvalForRelease` per destination. **Every
   recheck runs before the first write**, so nothing is written for a confirmation one of
   whose destinations is refused.
4. Freeze the draft **once**, then `recordRelease` per destination carrying `closed`
   forward, then store the result.

The expectation per destination is the **sequence** rather than the version number, because
a close and a reopen each append a row: one expectation therefore covers the released
version and the intake state together, and a close that landed after the review is a
`STALE_REVIEW` rather than a release that quietly reopened intake.

The composite primary key stays the race backstop, and a `23505` becomes `RELEASE_RACED`.
`fromEnvironment` is recorded per destination and derived from no sibling (F7).

Authorisation is the route's rather than the handler's: `environmentFrom: "targets"` makes
the middleware evaluate the cell once per listed environment and refuse on the first
failure, naming only that environment. A `publish-batch` with no destination is "create a
version without releasing it" and is authorised by `form: publish` alone.

## Test-to-production workflow

This section describes the **default revision**: what runs until a deployment writes one.

The admin's top switch fixes the release target; the release dialog selects a version,
not another environment. Its server action confirms the environment shown before
forwarding. `GET /forms/{id}` returns API-derived action capabilities, eligible version
numbers, the preferred candidate, the current release and its immutable definition.

When both test and prod are served, `POST /forms/{id}/releases` rejects a prod candidate
without historical test or prod releases with `409 TEST_RELEASE_REQUIRED`. Historical
prod releases keep legacy rollback available. Moving test to a later version does not
invalidate an earlier candidate. This rule follows permission and second-person checks.
A recorded test release does not assert that manual testing passed.

`POST /forms/{id}/publish-and-release` remains atomic, but targets test in the normal
workflow. Direct publication into prod is refused in a test/prod deployment. In prod,
the admin reviews stored content and releases an existing version; it never republishes
the shared draft. Prod-only deployments retain the original behavior.
