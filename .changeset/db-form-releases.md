---
"@roonga/qcms-db": minor
---

Add `control.form_releases`, the release record ADR-40 names: what is released to each
environment, with who released it, when, which published version, from which environment
it was promoted and with whose approval (task 065).

A release is a **record and never a copy**. The form id and the version number are the
published ones, so the version history stays shared and continuous across environments
(R1, R6, ADR-02, ADR-18), and promotion writes a row rather than duplicating a definition.
The primary key is `(form_id, environment, sequence)`, the sequence assigned by the same
scalar subquery `insertFormVersion` uses for a version number, so "the newest row for this
form in this environment" needs no timestamp tie-break and the row before it is
`sequence - 1` - which is the whole input to the rollback reading. `listFormReleases`
derives that reading with `lag(version)` partitioned by environment, so a release of an
earlier version than the one it replaced is marked rather than left for a reader to work
out from the row above.

The history is append-only at the database: two triggers in `control` reject an `UPDATE`
and a `DELETE`, the same division `control.form_versions` already uses, so the grant stays
the DML ADR-40's role table gives `qcms_app_control` and the immutability is a guard with
an error message.

The migration carries its own grants, because task 064 set no `ALTER DEFAULT PRIVILEGES`
and a table created after the baseline otherwise arrives with nobody granted on it - a
failure a migration does not report and a request finds later. `qcms_app_control` gets DML;
every `qcms_app_<env>` in the live set gets `SELECT`, enumerated from `control.environments`
rather than written out, so a role an operator created last week comes out of this
migration holding the whole six-table read list Q48 names.

New query helpers: `insertFormRelease`, `getReleasedVersion`, `listFormReleases`,
`listReleasedVersions` and `listEnvironments`. **`getReleasedVersion` is what a new session
resolves**, in place of `getLatestPublishedVersion`: a published version is served nowhere
until it is released, so a version released to `test` and not to `prod` is served in `test`
and refused in `prod`. Nothing re-pins a session already open - `getLatestPublishedVersion`
is unchanged and still answers "the newest version in the library", which is what the
authoring screens ask it.

**No subscriber sees a change.** `form.released` is written into the released environment's
`outbox` in the release's own transaction, and like the retired `form.published` before it
it is queued and never delivered: the deliverer fans out `response.submitted` only. The
event vocabulary moved; nothing an endpoint receives did.
