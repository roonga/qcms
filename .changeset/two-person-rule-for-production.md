---
"@roonga/qcms-db": patch
"create-qcms-app": patch
---

Task 070: the two-person rule for production, as one per-workspace switch governing two
acts.

`control.form_versions` gains `published_by`, which is the **author** the rule compares
against: the account that published the version, not whoever last edited the draft. The
column is nullable because the table is append-only, and a version published before it
existed cannot be released to `prod` while the rule is on - the rule compares two accounts
and one of them is unknown, so the conservative answer is no.

`control.webhook_endpoint_proposals` is new and holds a proposed `prod` endpoint change
until a second account confirms it. It is control-plane state, so **no environment role
holds any privilege on it**: proposing and confirming are an administrator's acts on
configuration, exactly as minting a secure link is while redeeming one is not. Migration
0005 carries the one grant that follows.

What an adopter should know. The switch is the workspace's `requireSecondApprover` and it is
**off by default**, including on the workspace a fresh database is seeded with: an
installation with one administrator cannot satisfy the rule at all. With it on, and in
`prod` alone:

- a release is **one act**, refused for the account that published the version and recorded
  on the release row as `approved_by`, so the approval is a row somebody can read rather
  than a UI step. `POST /forms/{id}/publish-and-release` is therefore refused outright for a
  gated production release: one account cannot be two, so the two acts have to be two
  requests;
- an endpoint change is **two acts**. The three configure routes answer `202` with the
  change stored pending instead of applying it, the live endpoint is untouched so the
  proposed URL receives nothing, and
  `POST /forms/{id}/webhooks/proposals/{proposalId}/confirm` applies it for a different
  `forms.approver` holding `prod` in scope. `DELETE` on the same path withdraws it, and
  every propose, confirm and withdraw writes a SEC-15 `setting` row.

Nothing changes for `dev` or `test`, or for a workspace that leaves the switch off: a
release there is self-service for an editor holding that environment, which is what keeps a
test cycle usable.
