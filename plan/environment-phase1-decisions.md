# Environment navigation: phase 1 decision pack

Status: proposal for Code Owner rulings, prepared 2026-10-29. Nothing here is decided.
It resolves the five decisions named under "Decisions required before their dependent
implementation" in [the implementation plan](environment-navigation-implementation.md),
audited against `origin/main` at `8dd38ea5` (which includes #1150, environment-bound
publishing). No option below weakens an existing policy row; every change to ADR text,
the permissions matrix or `docs/SECURITY_DESIGN.md` is named, not drafted.

Vocabulary: a **cell** is a `(resource, action)` pair from `policy.ts`; a **row** is a
route entry in `route-policy.ts`; **the matrix** is the second table in SEC-3 section 3.2,
which `plan/environments-and-workspaces.md` section 6 holds as its specification.

## What the code does today (audit summary)

| Area                 | Current behaviour on `origin/main`                                                                                                                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow             | `releases/workflow.ts`: when `test` and `prod` are both served, a `prod` release needs any prior release row of that version in `test` or `prod`; `publish-and-release` into `prod` is refused. Any other served set (prod-only, `dev`, `stg`) has no prerequisite. Nothing is stored; the rule is derived from names.  |
| Release transaction  | One release per request, one control-pool transaction, `form.released` enqueued schema-qualified without `RETURNING`. Races surface as `409 RELEASE_RACED` on the `(form_id, environment, sequence)` key. No idempotency key, no result lookup.                                                                         |
| Capabilities         | `GET /admin/forms/{id}` returns `workflow { enabled, environment, canEdit, canPublish, canRelease, eligibleVersions, preferredVersion, currentVersion }` computed for the **switcher** environment (G10). `canPublish` requires `release: create` in that environment, so draft-only publishing is hidden by the shell. |
| Discovery            | `GET /admin/forms` is `form: read` over `caller` workspaces; a caller holding only `responses.*` grants is refused (G02). `FormListItem` carries `status` (switcher environment), `hasDraft`, `latestVersion`, `publishedAt`; no release, workspace or count fields.                                                    |
| Installation rows    | Four `installationOnly` rows: `POST /admin/workspaces`, `PUT /admin/workspaces/{id}/shared`, `GET /admin/outbox/dead-letters`, `GET /admin/erasures`. Two grant-exempt routes, asserted by count. Nine resources, closed; `matrix-coverage.e2e.ts` fails on a tenth.                                                    |
| Claim                | Modelled as a `forms.owner` grant in every workspace; reaches no form, release, link, webhook or response cell anywhere.                                                                                                                                                                                                |
| Audit                | SEC-15 kinds closed at six (`read`, `export`, `erasure`, `grant`, `revoke`, `setting`); Q79 makes a seventh a decision.                                                                                                                                                                                                 |
| Environment settings | `control.environments` carries `position`, challenge provider and two TTLs; written by the operator command only, no update subcommand (Q72, #1095).                                                                                                                                                                    |

## Decision 1: workflow configuration schema and migration defaults

**Question.** How is a site's release flow (single prod, test/prod, dev/test/stg/prod,
flexible) represented, who writes it, and what does an existing deployment get?

| Option                                                                                                          | Trade-offs                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Keep the derived name rule; no configuration                                                                 | Zero migration. Cannot express `dev` before `test` or a flexible flow; G08 stays open; the wizard has nothing to read.                                                                                          |
| B. **Installation-wide, versioned, per-destination rule rows; absent configuration means today's derived rule** | Explicit prerequisites, typed columns (Q39), CAS on revision for the wizard, legacy semantics untouched until an administrator writes revision 1. One more control table pair and two routes.                   |
| C. Per-workspace workflow on the `organization` row                                                             | Lets departments differ. Multiplies review complexity per form, conflicts with ADR-40's environment set being installation-level, and mixes with `requireSecondApprover`, which the plan says to keep separate. |
| D. Operator CLI only, like environment provisioning                                                             | No HTTP write surface. Consistent with Q1 and Q72, but workflow is policy over provisioned environments rather than DDL, and the plan's Site configuration screen has no backend.                               |

**Recommendation: B.** Versioned rows, installation-wide, written by the installation
claim over HTTP (decision 4), with **no seeded row**: a deployment with no revision keeps
exactly today's derived behaviour and reports `source: "default"`.

Contract the recommendation implies:

```text
control.release_workflow_revisions
  revision        integer PK            -- 1, 2, ... append-only (reject-update, reject-delete triggers)
  created_at      timestamptz not null
  created_by      text not null         -- no FK, like form_releases.released_by
  note            text                  -- optional display text, never read for a decision

control.release_workflow_rules
  revision                   integer FK -> revisions
  environment                text FK -> control.environments.name
  requires_prior_release_in  text[] not null   -- environment names; a release of the same version in ANY listed one qualifies; [] = none
  allows_draft_publish       boolean not null  -- may a draft be frozen and released here in one act
  allows_in_batch            boolean not null  -- may this destination be one of several targets in one confirmation
  PK (revision, environment)
```

- Validation on write: every environment named is served; no environment lists itself
  in `requires_prior_release_in` (rollback is decision 2's exception, not a rule); the
  set is acyclic; `prod` keeps its role split and workspace two-person rule whatever the
  rules say (those are the matrix's and ADR-41's, not this table's).
- Default revision (no row): `prod` requires `["test"]` when `test` is served, else `[]`;
  `allows_draft_publish` is false for `prod` when `test` is served, else true; every
  non-prod environment has no prerequisite and allows draft publish; `allows_in_batch`
  is true everywhere. This is the current code, stated as data.
- The effective revision is read once per review and per commit, and the commit carries
  `expectedWorkflowRevision` (decision 5).
- The write is a SEC-15 `setting` row with `environment` and `form` empty and `detail`
  naming the revision and a compact rule summary (Q61 shape; no seventh kind).
- Name rule: `prod` stays the only protected literal; this table never renames or creates
  an environment.

Documents that change: ADR-40 (the 2026-10-26 amendment becomes "the default revision of
a configurable workflow"; the Q4 "no ordering requirement" sentence gains "unless the
configured workflow requires one"); `plan/environments-and-workspaces.md` section 6 (a new
Q row for the ruling; Q4 and Q11 amended); `apps/api/src/features/releases/README.md`
(workflow section); `plan/form-publishing-workflow.md` (status line). SEC rows: none for
the schema itself; SEC-15 gains one sentence listing the workflow write under `setting`.

## Decision 2: prerequisite evidence and rollback exceptions

**Question.** What counts as evidence that a target's prerequisite is met, and when may a
version skip prerequisites?

| Option                                                                      | Trade-offs                                                                                                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. **Any committed release row of that version in a required environment**  | Matches `productionVersions()` today; a later `test` release does not invalidate an earlier candidate. Proves availability only, never a test pass. |
| B. Version must be the **currently** released one in a required environment | Stricter; breaks the plan's "moving test forward does not invalidate a candidate" and today's behaviour.                                            |
| C. Persisted test-pass attestation or approval inbox                        | Real QA evidence. New table, new actor rule, probably a seventh SEC-15 kind (Q79) and a new matrix row. Separate product and security work.         |

**Recommendation: A**, with two exceptions and one batch rule:

- **Rollback exception.** A version with any prior release row in the **target**
  environment itself is eligible there regardless of prerequisites. This is today's
  legacy production rollback, generalised to every environment.
- **Two-person rule is not an evidence rule.** `approvalForRelease` still runs for every
  `prod` target, rollback included; a prior release never substitutes for a second account.
- **Batch rule.** Evidence is read from committed rows before the transaction's first
  write; a sibling target in the same confirmation never supplies evidence. Selecting
  `dev` and `test` together fails `test` when `test` requires `dev`.

Contract:

```text
Review (decision 5) per target:
  evidence:  [{ environment, version, sequence, releasedAt }]   -- the rows that satisfied the rule, or []
  blockers:  [{ code: "PRIOR_RELEASE_REQUIRED", requiresAnyOf: string[] }, ...]
Commit refusal: 409 PRIOR_RELEASE_REQUIRED { environment, requiresAnyOf }
```

- `TEST_RELEASE_REQUIRED` stays emitted while the deployment is on the default revision,
  so the shipped admin keeps its message until phase 5 replaces the client; the general
  code replaces it when revision 1 is written. Code Owner call: rename now or keep both.
- No persisted "tested" state, no approval inbox, no test-pass label in any DTO.

Documents that change: ADR-40 2026-10-26 amendment (generalise "test, or prod for legacy
rollback" to "a required environment, or the target itself"); `plan/form-publishing-workflow.md`
"Production eligibility" bullets; `apps/api/src/features/releases/README.md`. No matrix row.

## Decision 3: operations discovery per role

**Question.** Which form metadata may each of the six roles and the installation claim
discover for an explicitly requested environment, and how does an eraser without a viewer
grant act (G05)?

| Option                                                                                      | Trade-offs                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Reuse `GET /admin/forms` and loosen its row to admit response roles                      | One list. Hands drafts, `hasDraft` and publication state to roles the matrix gives no `form: read`; widens a cell.                                                                            |
| B. **New bounded query authorised by the union of the caller's operational cells per form** | Minimal metadata per cell, no draft fields, counts gated per form and environment. Needs one route-policy mechanism extension (`anyOf`), which is a table change rather than a matrix change. |
| C. Grant-exempt route like `GET /admin/me/access`                                           | No policy row. The exemption list is asserted at exactly two, and a third carrying form metadata is a route with no cell at all, which is the failure the table exists to prevent.            |

**Recommendation: B.** Route `GET /admin/operations/forms?environment=E&q=&workspaceId=&intake=&sort=&cursor=&limit=`.

What each principal may see, for environment `E`:

| Principal                  | Rows returned                                                         | Fields                                                                                                              | Rails offered                                                     |
| -------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `forms.viewer`             | Forms in workspaces holding `form: read`                              | identity, workspace, `release {version, releasedAt, closed} \| null`, `lastReleaseAt`; no counts                    | Overview, Links (masked URL, Q58), Webhooks (masked), Versions    |
| `forms.editor`             | Same as viewer                                                        | Same, unmasked URLs (Q73); per-row `capabilities` names non-prod writes held in `E`                                 | Same plus writes in non-prod `E`                                  |
| `forms.approver`           | Same as viewer                                                        | Same; `capabilities` names writes held in `E`, `prod` included                                                      | Same plus writes in `E`; no draft editing                         |
| `forms.owner` (alone)      | **None.** Ownership touches no form cell                              | n/a                                                                                                                 | No Operations entry; Workspaces mode only                         |
| `responses.viewer`         | Forms where `response: read` holds in `E` and the form is in scope    | identity, workspace name, `hasRelease`, `counts {submitted, inProgress}`; no version, no intake, no draft, no links | Responses only                                                    |
| `responses.eraser`         | Forms where `response: erase` or `dispose` holds in `E` and in scope  | identity, workspace name, `hasRelease`; no counts, no version                                                       | Erase (known target), Dispose (known target)                      |
| Installation claim (alone) | **None** (G06)                                                        | n/a                                                                                                                 | Delivery failures, Erasure log; environment selector served whole |
| Combined grants            | Union of the rows above; each row's fields are the union of its cells | A `responses.viewer` who is also a `forms.viewer` gets release fields and counts                                    | Union                                                             |

Rules carried by the contract:

- `identity` is `formId`, `slug`, `defaultLocale` and the display name the admin already
  derives; never a draft body, `hasDraft`, `latestVersion` or `publishedAt` for a
  response-only caller.
- `counts` and count sorting require `response: read` for that exact form and `E`,
  computed on `E`'s pool under `qcms_app_<env>`; the control pool reads no data schema.
  A count writes **no** SEC-15 row (existence without content, the `erasure-scope`
  precedent); Code Owner may rule otherwise.
- `workspaces` filter options list only workspaces that contributed a row.
- Filter, then count, then sort, then page; tie-break on `(slug, formId)`; cursor
  pagination; `limit` capped.
- `hasRelease: false` is distinct from `release.closed: true`.
- Failed `E` resolution is a 400 naming no other environment; a caller holding nothing in
  `E` gets an empty page, not a 403, because the shell must not read discovery failure as
  denial (G12).

**G05, the eraser-without-viewer journey.** Recommend the **known-target** journey, with
the viewer grant as the owner's choice rather than a silent default:

1. Operations forms table shows the eraser's forms (above). Selecting one opens an Erase
   panel with a session id field; there is no list.
2. `GET /admin/forms/{id}/responses/{sessionId}/erasure-scope` (existing eraser cell,
   `E` from the explicit Operations context) answers existence in `E` and the other
   environments the caller may erase in (Q71). A missing session is a 404 naming nothing.
3. Type-to-confirm (`isErasureConfirmed`) and `POST .../erase` in `E`; the result offers
   the Q7 repetition per other environment, each its own confirmation.
4. Dispose (unflag) takes the same shape with the same field. The screen states that
   browsing withheld or submitted responses needs a `responses.viewer` grant from a
   workspace owner, and names no person.

Documents that change: SEC-3 section 3.1 (the policy table gains an `anyOf` row shape;
"the environment the policy checks is exactly the environment the handler acts in" now
reads the explicit `environment` query, so `environmentFrom` gains `"query"`); ADR-41 Note
on enforcement (same sentence); the matrix gains one row, "Discover operational form
metadata in an environment", with `yes` for the three `forms.` roles, `env and form in
scope` for the two `responses.` roles, empty for `forms.owner` and the claim; `docs/openapi/admin.json`;
`route-policy.test.ts` derivation; `01-authorization-matrix.e2e.ts` probes;
`docs/erasure.md` for the known-target journey.

## Decision 4: installation configuration actions and the closed matrix rows

**Question.** Which cells authorise reading and writing the release workflow, and what
changes in the closed vocabulary?

| Option                                                                                                                  | Trade-offs                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. A tenth resource `installation` with `read` and `configure`                                                          | Legible. Opens the closed `RESOURCES` list; `matrix-coverage.e2e.ts` and the ADR-41 "nine resources" sentence change; every role must be re-declared against it.                  |
| B. **Reuse `workspace: update` on an `installationOnly` row for the write; `release: read` over `caller` for the read** | No new vocabulary; same shape as `POST /admin/workspaces`. The read is as public as release history, which is what publishers need. Five `installationOnly` rows instead of four. |
| C. Operator CLI only                                                                                                    | See decision 1 option D.                                                                                                                                                          |

**Recommendation: B.** Installation-only writes; publishers get a permission-filtered
evaluation through the candidate review (decision 5) rather than administration access.

Policy rows:

```text
{ GET, /admin/release-workflow, release, read,   caller,       }                        -- viewer, editor, approver in any workspace
{ PUT, /admin/release-workflow, workspace, update, installation, installationOnly }    -- the claim alone; SEC-15 setting row
```

DTOs:

```text
GET  -> { revision: number | null, source: "default" | "configured",
          environments: [{ name, position, protected: boolean, requiresPriorReleaseIn: string[],
                           allowsDraftPublish: boolean, allowsInBatch: boolean }] }
PUT  <- { expectedRevision: number | null, rules: [{ environment, requiresPriorReleaseIn, allowsDraftPublish, allowsInBatch }], note? }
     -> 200 same shape as GET | 409 WORKFLOW_REVISION_STALE | 400 WORKFLOW_RULE_INVALID { environment, reason }
```

- `protected` is true for `prod` only and is read-only: it reports the matrix's split and
  the workspace switch, which this configuration cannot alter.
- The `GET` row is `caller` with `release: read`, so a `forms.owner` alone and a
  `responses.*` holder alone are refused, matching the matrix's read rows.
- Environment provisioning, renaming and the per-environment settings on
  `control.environments` stay the operator command's (Q1, Q72); the screen links to the
  operator documentation instead of offering them.

Matrix rows that change (both copies: SEC-3 section 3.2 and `plan/environments-and-workspaces.md`):

| Row                                                                           | Change                                                                                    |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| "Create workspaces, mark the shared one, environment settings, user accounts" | Append "release-workflow configuration"; cell stays `yes` for the installation admin only |
| New: "Read the release-workflow configuration"                                | `yes` for `forms.viewer`, `forms.editor`, `forms.approver`; empty elsewhere               |
| New: "Discover operational form metadata in an environment" (decision 3)      | As stated in decision 3                                                                   |
| "Read any response anywhere"                                                  | Unchanged `never`                                                                         |

Other named changes: `route-policy.ts` and `resolver.ts` comments saying "four rows are
the claim's alone" become five; ADR-41 Note (same count); SEC-15 section 8b lists the
workflow write under `setting`; `matrix-coverage.e2e.ts` probes for the two new rows.

## Decision 5: concurrency, idempotency, retention and result lookup

**Question.** How does one confirmation publish at most one snapshot and release to every
target atomically, survive an uncertain response, and let a reloaded client find its
outcome?

| Option                                                                                      | Trade-offs                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Client loops over `POST /releases` per target                                            | No backend work. Partial batches, no single snapshot guarantee, N confirmations; the plan forbids it.                                                                                  |
| B. **Stateless review plus one batch commit carrying expectations and a client-minted key** | One transaction, CAS on every input the review showed, replay on key reuse. One small control table and three routes; the route-policy table learns a multi-target environment source. |
| C. Server-side review token table                                                           | Review state survives reloads, but it is a second table with its own expiry, and the token is still just the expectations below.                                                       |

**Recommendation: B.**

Routes and rows:

```text
POST /admin/forms/{id}/release-review          release, read,   form                                       -- no write; returns per-target evaluation filtered to the caller's cells
POST /admin/forms/{id}/release-batch           release, create, form, environmentFrom: "targets"          -- every element of body.targets[].environment
POST /admin/forms/{id}/publish-batch           form, publish,   form, also: release create, environmentFrom: "targets"
GET  /admin/forms/{id}/release-batches/{key}   release, read,   form                                       -- result lookup
```

- `environmentFrom: "targets"` is a route-policy mechanism extension: the middleware
  evaluates the cell once per listed environment and refuses on the first failure, and
  refuses an empty list. The refusal names the failing environment and nothing else.
- `publish-batch` with an empty `targets` is "Create version without releasing" and needs
  `form: publish` alone; the `also` cell is evaluated only over the listed targets.

Review response (per target, only for targets the caller holds `release: create` in;
others are omitted, never disabled-with-reason at the API):

```text
{ source: { kind: "draft", draftRevision } | { kind: "version", version, publishedBy },
  workflowRevision: number | null,
  targets: [{ environment, currentVersion, currentSequence, closed, evidence, blockers,
              twoPerson: { applies, refusedAsAuthor } , protected }] }
```

Commit body and result:

```text
{ idempotencyKey: uuid, expectedWorkflowRevision, source, targets: [{ environment, expectedSequence, fromEnvironment? }] }
-> 200 { version, releases: [ReleaseRecord...], replayed: boolean }
-> 409 STALE_REVIEW { environment?, field }     -- any expectation differs; nothing written
-> 409 PRIOR_RELEASE_REQUIRED | ALREADY_RELEASED | RELEASE_RACED | APPROVER_UNKNOWN_AUTHOR
-> 403 APPROVER_IS_AUTHOR
-> 422 IDEMPOTENCY_KEY_REUSED                   -- same key, different intent hash
```

Transaction, on the control pool, in this order:

1. `SELECT ... FOR UPDATE` on the `control.forms` row: one publish or batch per form at a
   time, deterministic and deadlock-free.
2. Look up `control.release_batches` by `(principal, form_id, idempotency_key)`; a
   committed row with an equal intent hash returns its stored result (`replayed: true`);
   a different hash is `422`.
3. Recheck `expectedWorkflowRevision`, the draft revision (`form_drafts.updated_at`, or a
   new `revision` integer if the Code Owner prefers a counter), and every target's newest
   `(sequence, closed)`; recheck evidence (decision 2) and `approvalForRelease` per target.
4. Freeze the draft once (`freezeDraft`, `writeVersion` with `published_by`), then
   `recordRelease` per target carrying `closed` forward, then insert the batch row with the
   result. Any failure rolls back everything.
5. The composite primary key stays the race backstop; a `23505` becomes `RELEASE_RACED`.

Idempotency table:

```text
control.release_batches
  principal_id     text not null
  form_id          text not null FK -> forms
  idempotency_key  uuid not null
  intent_hash      text not null       -- sha256 of the canonical body minus the key
  result           jsonb not null      -- the 200 body
  created_at       timestamptz not null
  PK (principal_id, form_id, idempotency_key)
```

- Key scope is **principal and form**: another account reusing a key cannot read or
  replay a result it did not create, and the form bound keeps the row on the form's lock.
- Only successes are stored; a refusal creates nothing and the same key may be retried.
- Retention: **7 days**, removed by a control-pool step in the existing sweep (the control
  role already holds `DELETE` on its own tables; no data-schema privilege changes).
  Alternatives for the ruling: 24 hours, or never (rows are small, history is append-only
  elsewhere).
- Result lookup after reload: the client persists the key before sending; `GET
.../release-batches/{key}` returns the stored result, or 404 meaning "not committed,
  resend the same key". The release history remains the authoritative long-term answer.

Documents that change: SEC-3 section 3.1 (`environmentFrom` gains `"targets"`, and the
"one route is two cells" paragraph names `publish-batch`); ADR-41 Note (same); ADR-40
(the 2026-10-26 amendment's "server actions reject stale environment confirmations"
becomes the expectations contract above; the two-person Note's "two acts become two
requests" survives, because a gated `prod` target in a `publish-batch` is refused);
`apps/api/src/features/releases/README.md` and `forms/README.md`; `docs/openapi/admin.json`.

## Further decisions the plan needs

| #   | Decision                                                                                                                                                | Recommendation                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Shell capability projection (G12). `GET /admin/me/access` carries grants but no computed capabilities; a third grant-exempt route is a reviewed change. | Extend `MyAccessResponse` with `capabilities { operations, workspaces, siteConfiguration, authoring }` derived by `decideAccess`; no new route |
| F2  | Draft revision for CAS. `form_drafts` has `updated_at` only; two saves in one millisecond are indistinguishable.                                        | Add an integer `revision` to `form_drafts`, bumped on every `PUT /draft`, surfaced in `GET /forms/{id}`                                        |
| F3  | Dispose-only (unflag) journey. The withheld list is `response: read`; an eraser alone cannot browse flagged responses.                                  | Known-target, as G05 above; say so in `docs/webhooks.md`                                                                                       |
| F4  | Counts and SEC-15. Whether an aggregate count is a `read`.                                                                                              | Not a read; no row (decision 3). Needs an explicit ruling because SEC-15's definition says "response read"                                     |
| F5  | `TEST_RELEASE_REQUIRED` versus `PRIOR_RELEASE_REQUIRED`.                                                                                                | Keep the old code on the default revision until phase 5; general code once configured (decision 2)                                             |
| F6  | `GET /forms/{id}.workflow` computed for the switcher environment (G10).                                                                                 | Mark deprecated in phase 2; remove in phase 5 once the wizard reads `release-review`                                                           |
| F7  | `fromEnvironment` in a batch. Today it is client-supplied and authorises nothing.                                                                       | Keep optional per target, recorded only; never derived from another target in the same batch                                                   |
| F8  | Site configuration menu visibility for a `forms.owner`. The plan says owners do not gain it.                                                            | Visible to the claim only (decision 4); owners see Workspaces mode                                                                             |
| F9  | Whether `allows_in_batch` may ever be true for `prod`.                                                                                                  | Allowed by data; the two-person rule and the draft refusal still apply per target, so the default revision leaves it true                      |

## Conflicts with current code or decisions

| #   | Conflict                                                                                                                                                                                                                                                                                                                                                     | Needed ruling                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **ADR-40 amendment 2026-10-26 and `plan/form-publishing-workflow.md` (built by #1150)** fix the release target to the top switch, remove target selectors from release dialogs and require switching to `prod` before releasing. The plan's wizard chooses explicit destinations and says "do not require switching a global header environment to publish". | Amend ADR-40 so the switch governs operational data (Operations mode) and the wizard governs destinations, or narrow the plan to the shipped model. Phases 3 and 5 depend on this ruling. |
| C2  | ADR-40 Q4 "no ordering requirement" versus the 2026-10-26 amendment (test before prod) versus decision 1 (configured prerequisites).                                                                                                                                                                                                                         | Q4 row and ADR-40 text amended together with decision 1                                                                                                                                   |
| C3  | `apps/api/src/features/releases/README.md` route table still says `POST /forms/{id}/releases` is `forms:write` and `GET /environments` is `forms:read`; `route-policy.ts` has `release: create` and a grant-exempt route.                                                                                                                                    | Documentation fix only; fold into decision 1's README edit                                                                                                                                |
| C4  | `resolver.ts` lists "the environment list" among the four acts the claim holds alone; `GET /admin/environments` is grant-exempt and served to every grant holder.                                                                                                                                                                                            | Comment fix when the count moves to five (decision 4)                                                                                                                                     |
| C5  | The plan's role table says `forms.approver` holds "scoped release, intake, link and webhook writes, including prod" with no `dev`/`test` restriction; code agrees (approver holds the same cells, scope decides). `docs/environment-capabilities.md` on the plan branch says "Editor or approver" for non-prod, consistent.                                  | None; recorded as checked                                                                                                                                                                 |
| C6  | The plan says the Operations environment selector is explicit and the header switcher's cookie is "a convenience, never authorization"; `GET /forms/{id}/responses` and the webhook configure routes read `environmentFrom: "switcher"`.                                                                                                                     | Phase 4 must send the explicit Operations environment as that header; or decision 3's `"query"` source extends to those routes, which is a route-policy change per row                    |
| C7  | `plan/environments-and-workspaces.md` section 7 says "nothing is deferred"; decisions 1 to 5 reopen the section's numbering (next Q is Q84).                                                                                                                                                                                                                 | Record the rulings as Q84 onward in section 6                                                                                                                                             |

## Dependencies between the decisions

- Decision 1 before 2 (evidence reads rules), before 4 (rows name the table), before 5
  (commit carries `expectedWorkflowRevision`).
- Decision 3 is independent of 1, 2 and 5 and can start phase 2 on its own.
- C1 gates phases 3 and 5 but not phase 2.
