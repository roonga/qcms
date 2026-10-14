# Releases, promotion and the environment set (task 065)

ADR-40: an environment is a **release state over the one immutable version history**,
never a second copy of it. A version is published once, into `control`, and is shared by
every environment (ADR-18); what varies per environment is which published version is
**released** there. This slice is the second act.

## Routes

| Method | Path                   | Scope         | Notes                                                                                                                                                    |
| ------ | ---------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/forms/{id}/releases` | `forms:write` | Release or promote a published version. Writes one record, copies nothing.                                                                               |
| `GET`  | `/forms/{id}/releases` | `forms:read`  | The release history, newest first, each rollback marked. `?environment=`. It is also what "released where" is read from: the newest row per environment. |
| `GET`  | `/releases`            | `forms:read`  | What is released where: the current release per form. `?environment=`.                                                                                   |
| `GET`  | `/environments`        | `forms:read`  | The live set, in `position` order, for the Q6 switcher.                                                                                                  |

The combined **publish and release** action lives in the forms slice
(`POST /forms/{id}/publish-and-release`), because it publishes: it shares that slice's
validation and compile, and calls `recordRelease` here for the second half. One
transaction covers both.

## The release transaction

`release.ts` is the whole of it, and it is one function because two routes perform it:

1. `insertFormRelease` writes the `control.form_releases` row, its `sequence` assigned by
   a scalar subquery so two concurrent releases into one environment cannot claim the same
   place in the history.
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
- **No ordering requirement** (Q4). A release straight to `prod` succeeds and records that
  it had no source environment.
- **No approval rule.** `approvedBy` exists from this task and is written by task 070's
  two-person rule for `prod` (Q51). Nothing here enforces who may fill it.
- **No membership check.** The workspace role and its environment scope arrive with tasks
  068 and 069; a check before they exist would be inventing one.
- **No closed state.** The per-environment closed value is task 066's.
- **No link minting.** An environment on a minted link is task 066's (Q19), so a link
  minted today is still `prod` whatever the switcher says.

## The environment set

`GET /environments` reads `control.environments`, which is the source of the set, ordered
by `position` (the canonical order of Q42), intersected with the pools this process holds.
It rides this slice because the switcher and the release screens are one feature: the
switcher offers exactly the environments a release can name.

The switcher's **selection** travels the other way, as the `x-qcms-environment` header,
read by `middleware/request-environment.ts` on the admin group alone - so every admin
screen reads its own environment's data and a respondent request cannot name an
environment at all.
