---
"@roonga/qcms-db": minor
"create-qcms-app": patch
---

A scaffolded installation gets the configurable release workflow and the atomic publish
transaction: three control-plane tables, the draft revision a confirmation rechecks, and
the retention step that sweeps a stored confirmation result.

`control.release_workflow_revisions` and `control.release_workflow_rules` hold
installation-wide, versioned rule rows: per destination, the environments a prior release
of the same version must exist in, whether a draft may be frozen and released there in one
act, and whether it may be one of several destinations in one confirmation. **No row is
seeded**, so a deployment with no revision keeps exactly its derived behaviour and reports
`source: "default"`. Both tables are **append-only** at the database, with reject-update and
reject-delete triggers: a rule change writes a new revision, so a release refused under an
earlier revision stays explainable, and rolling a configuration back is writing the earlier
rules as a new revision, exactly as rolling a release back is releasing an earlier version.
`effectiveReleaseWorkflow`, `latestReleaseWorkflowRevision` and
`insertReleaseWorkflowRevision` are the helpers; the revision number is assigned by a
scalar subquery, so two concurrent writes cannot claim one.

`control.release_batches` stores the result of one successful confirmation, keyed on the
principal, the form and a client-minted idempotency key, with the hash of the canonical
intent. It carries **no append-only trigger** and a seven-day retention, deliberately: it
is a replay cache rather than an audit record, since what a confirmation did is in
`control.form_releases`, and this table only lets a reloaded client find an outcome it
already caused. `purgeExpiredReleaseBatches` is the sweep and
`RELEASE_BATCH_RETENTION_MS` the window. **No environment role holds any privilege on any
of the three**: none is on the control read list, so the credential serving anonymous
respondent traffic can read neither the workflow configuration nor a stored result.

`control.form_drafts` gains an integer `revision`, bumped inside `upsertDraft` so no save
path can forget it. `updatedAt` could not do that job: two saves in one clock tick carry
the same timestamp, and a confirmation has to be able to tell that the draft moved.

`lockForm` reads a form identity and holds its row for the rest of the transaction, which
is what serialises one publish or release confirmation per form.
