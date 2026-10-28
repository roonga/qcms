# Environment navigation: phase 1 decision record

Status: **ruled (Code Owner, 2026-10-29, PR #1163)**. Every decision below is recorded as
Q84 to Q91 in [`environments-and-workspaces.md`](environments-and-workspaces.md) section 6.
It closes the decisions named under "Decisions required before their dependent
implementation" in [the implementation plan](environment-navigation-implementation.md),
audited against `origin/main` at `8dd38ea5`. No ruling weakens an existing policy row.

Vocabulary: a **cell** is a `(resource, action)` pair from `policy.ts`; a **row** is a
route entry in `route-policy.ts`; **the matrix** is the second table in SEC-3 section 3.2,
which `plan/environments-and-workspaces.md` section 6 holds as its specification.

## Baseline the rulings were made against

| Area                 | Behaviour on `origin/main` at `8dd38ea5`                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workflow             | `releases/workflow.ts`: when `test` and `prod` are both served, a `prod` release needs any prior release row of that version in `test` or `prod`; `publish-and-release` into `prod` is refused. Any other served set has no prerequisite. Nothing is stored. |
| Release transaction  | One release per request, one control-pool transaction, `form.released` enqueued schema-qualified without `RETURNING`. Races surface as `409 RELEASE_RACED`. No idempotency key, no result lookup.                                                            |
| Capabilities         | `GET /admin/forms/{id}` returns `workflow { enabled, environment, canEdit, canPublish, canRelease, eligibleVersions, preferredVersion, currentVersion }` for the switcher environment (G10); `canPublish` also requires `release: create` there.             |
| Discovery            | `GET /admin/forms` is `form: read` over `caller` workspaces; a caller holding only `responses.*` grants is refused (G02). `FormListItem` carries `status`, `hasDraft`, `latestVersion`, `publishedAt`; no release, workspace or count fields.                |
| Installation rows    | Four `installationOnly` rows: `POST /admin/workspaces`, `PUT /admin/workspaces/{id}/shared`, `GET /admin/outbox/dead-letters`, `GET /admin/erasures`. Two grant-exempt routes, asserted by count. Nine resources, closed.                                    |
| Claim                | Modelled as a `forms.owner` grant in every workspace; reaches no form, release, link, webhook or response cell anywhere.                                                                                                                                     |
| Audit                | SEC-15 kinds closed at six (`read`, `export`, `erasure`, `grant`, `revoke`, `setting`); Q79 makes a seventh a decision.                                                                                                                                      |
| Environment settings | `control.environments` carries `position`, challenge provider and two TTLs; written by the operator command only, no update subcommand (Q72, #1095).                                                                                                         |

## Decision 1: workflow configuration schema and migration defaults

**Ruled (Code Owner, 2026-10-29), Q85.** Installation-wide, versioned, per-destination
rule rows, written by the installation claim over HTTP (decision 4), with **no seeded
row**: a deployment with no revision keeps exactly today's derived behaviour and reports
`source: "default"`.

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
  rules say.
- Default revision (no row): `prod` requires `["test"]` when `test` is served, else `[]`;
  `allows_draft_publish` is false for `prod` when `test` is served, else true; every
  non-prod environment has no prerequisite and allows draft publish; `allows_in_batch`
  is true everywhere. This is the current code, stated as data.
- The effective revision is read once per review and per commit; the commit carries
  `expectedWorkflowRevision` (decision 5).
- The write is a SEC-15 `setting` row with `environment` and `form` empty and `detail`
  naming the revision and a compact rule summary (Q61 shape; no seventh kind).
- `prod` stays the only protected literal; this table never renames or creates an
  environment.

Recorded in: ADR-40 (amendment of 2026-10-29); `plan/environments-and-workspaces.md`
Q4 and Q85; `apps/api/src/features/releases/README.md`. Phase 3 builds it.

## Decision 2: prerequisite evidence and rollback exceptions

**Ruled (Code Owner, 2026-10-29), Q86.** Evidence is **any committed release row of that
version in a required environment**, with two exceptions and one batch rule:

- **Rollback exception.** A version with any prior release row in the **target**
  environment itself is eligible there regardless of prerequisites.
- **Two-person rule is not an evidence rule.** `approvalForRelease` still runs for every
  `prod` target, rollback included.
- **Batch rule.** Evidence is read from committed rows before the transaction's first
  write; a sibling target in the same confirmation never supplies evidence.

```text
Review (decision 5) per target:
  evidence:  [{ environment, version, sequence, releasedAt }]   -- the rows that satisfied the rule, or []
  blockers:  [{ code: "PRIOR_RELEASE_REQUIRED", requiresAnyOf: string[] }, ...]
Commit refusal: 409 PRIOR_RELEASE_REQUIRED { environment, requiresAnyOf }
```

- `TEST_RELEASE_REQUIRED` stays emitted on the default revision until phase 5 replaces the
  client; `PRIOR_RELEASE_REQUIRED` replaces it once revision 1 is written (F5).
- No persisted test-pass state, no approval inbox, no test-pass label in any DTO.

Recorded in: ADR-40 (amendment of 2026-10-29); Q86; `plan/form-publishing-workflow.md`
and `apps/api/src/features/releases/README.md` when phase 3 lands.

## Decision 3: operations discovery per role

**Ruled (Code Owner, 2026-10-29), Q87.** A new bounded query,
`GET /admin/operations/forms?environment=E&q=&workspaceId=&intake=&sort=&cursor=&limit=`,
authorised by the union of the caller's operational cells per form through a new `anyOf`
row shape in `route-policy.ts` (`form: read` | `response: read` | `response: erase` |
`response: dispose`, `environmentFrom: "query"`).

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

- `identity` is `formId`, `slug`, `defaultLocale` and the derived display name; never a
  draft body, `hasDraft`, `latestVersion` or `publishedAt` for a response-only caller.
- `counts` and count sorting require `response: read` for that exact form and `E`,
  computed on `E`'s pool under `qcms_app_<env>`. **A count writes no SEC-15 row** (Q91).
- `workspaces` filter options list only workspaces that contributed a row.
- Filter, then count, then sort, then page; tie-break on `(slug, formId)`; cursor
  pagination; `limit` capped.
- `hasRelease: false` is distinct from `release.closed: true`.
- An unserved `E` is a 400 naming no other environment; a caller holding nothing in `E`
  gets an empty page, not a 403 (G12).

**G05, the eraser-without-viewer journey: known target.**

1. The Operations forms table shows the eraser's forms. Selecting one opens an Erase panel
   with a session id field; there is no list.
2. `GET /admin/forms/{id}/responses/{sessionId}/erasure-scope` (existing eraser cell, `E`
   from the explicit Operations context) answers existence in `E` and the other
   environments the caller may erase in (Q71). A missing session is a 404 naming nothing.
3. Type-to-confirm (`isErasureConfirmed`) and `POST .../erase` in `E`; the result offers
   the Q7 repetition per other environment, each its own confirmation.
4. Dispose (unflag) takes the same shape (F3). The screen states that browsing responses
   needs a `responses.viewer` grant from a workspace owner, and names no person.

Recorded in: SEC-3 section 3.1 and 3.2 (the row "Discover operational form metadata in an
environment" joins the matrix when the route lands, so `matrix-coverage.e2e.ts` keeps its
route-per-row property); ADR-41 Note; Q87 and Q91; `docs/erasure.md` in phase 6.

## Decision 4: installation configuration actions and the closed matrix rows

**Ruled (Code Owner, 2026-10-29), Q88.** No tenth resource. The write reuses
`workspace: update` on a fifth `installationOnly` row; the read is `release: read` over
`caller`. Publishers get a permission-filtered evaluation through the candidate review
(decision 5), not administration access.

```text
{ GET, /admin/release-workflow, release, read,   caller }                              -- viewer, editor, approver in any workspace
{ PUT, /admin/release-workflow, workspace, update, installation, installationOnly }    -- the claim alone; SEC-15 setting row

GET  -> { revision: number | null, source: "default" | "configured",
          environments: [{ name, position, protected: boolean, requiresPriorReleaseIn: string[],
                           allowsDraftPublish: boolean, allowsInBatch: boolean }] }
PUT  <- { expectedRevision: number | null, rules: [{ environment, requiresPriorReleaseIn, allowsDraftPublish, allowsInBatch }], note? }
     -> 200 same shape as GET | 409 WORKFLOW_REVISION_STALE | 400 WORKFLOW_RULE_INVALID { environment, reason }
```

- `protected` is true for `prod` only and read-only: it reports the matrix's split and the
  workspace switch, which this configuration cannot alter.
- A `forms.owner` alone and a `responses.*` holder alone are refused the read, matching
  the matrix's read rows. Site configuration is visible to the claim only (F8).
- Environment provisioning, renaming and the per-environment settings stay the operator
  command's (Q1, Q72).

Matrix changes (SEC-3 section 3.2 and the plan copy):

| Row                                                                                                           | Change                                                                          |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| "Create workspaces, mark the shared one, environment settings, user accounts, release-workflow configuration" | Reworded now; cell stays `yes` for the installation admin only                  |
| "Read the release-workflow configuration"                                                                     | Joins when the route lands: `yes` for the three `forms.` roles, empty elsewhere |
| "Discover operational form metadata in an environment"                                                        | Joins when the route lands (decision 3)                                         |
| "Read any response anywhere"                                                                                  | Unchanged `never`                                                               |

Recorded in: SEC-3 section 3.2; SEC-15 section 8b (the workflow write is a `setting`
row); ADR-41 Note; Q88; `route-policy.ts`, `resolver.ts` and `matrix-coverage.e2e.ts`
when the rows land.

## Decision 5: concurrency, idempotency, retention and result lookup

**Ruled (Code Owner, 2026-10-29), Q89.** Stateless review plus one batch commit carrying
expectations and a client-minted key.

```text
POST /admin/forms/{id}/release-review          release, read,   form                                       -- no write; per-target evaluation filtered to the caller's cells
POST /admin/forms/{id}/release-batch           release, create, form, environmentFrom: "targets"          -- every element of body.targets[].environment
POST /admin/forms/{id}/publish-batch           form, publish,   form, also: release create, environmentFrom: "targets"
GET  /admin/forms/{id}/release-batches/{key}   release, read,   form                                       -- result lookup
```

- `environmentFrom: "targets"` is a route-policy mechanism extension: the middleware
  evaluates the cell once per listed environment and refuses on the first failure, naming
  that environment and nothing else; an empty list is refused on `release-batch`.
- `publish-batch` with an empty `targets` is "Create version without releasing" and needs
  `form: publish` alone; the `also` cell is evaluated only over the listed targets.

```text
Review  -> { source: { kind: "draft", draftRevision } | { kind: "version", version, publishedBy },
             workflowRevision: number | null,
             targets: [{ environment, currentVersion, currentSequence, closed, evidence, blockers,
                         twoPerson: { applies, refusedAsAuthor }, protected }] }      -- only targets the caller holds release: create in

Commit  <- { idempotencyKey: uuid, expectedWorkflowRevision, source, targets: [{ environment, expectedSequence, fromEnvironment? }] }
        -> 200 { version, releases: [ReleaseRecord...], replayed: boolean }
        -> 409 STALE_REVIEW { environment?, field }     -- any expectation differs; nothing written
        -> 409 PRIOR_RELEASE_REQUIRED | ALREADY_RELEASED | RELEASE_RACED | APPROVER_UNKNOWN_AUTHOR
        -> 403 APPROVER_IS_AUTHOR
        -> 422 IDEMPOTENCY_KEY_REUSED                   -- same key, different intent hash
```

Transaction, on the control pool, in this order:

1. `SELECT ... FOR UPDATE` on the `control.forms` row: one publish or batch per form at a
   time.
2. Look up `control.release_batches` by `(principal, form_id, idempotency_key)`; an equal
   intent hash replays the stored result (`replayed: true`); a different hash is `422`.
3. Recheck `expectedWorkflowRevision`, the draft `revision` (F2) and every target's newest
   `(sequence, closed)`; recheck evidence (decision 2) and `approvalForRelease` per target.
4. Freeze the draft once, then `recordRelease` per target carrying `closed` forward, then
   insert the batch row with the result. Any failure rolls back everything.
5. The composite primary key stays the race backstop; a `23505` becomes `RELEASE_RACED`.

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

- Key scope is principal and form; another account cannot replay a result it did not
  create.
- Only successes are stored; a refusal creates nothing and the same key may be retried.
- Retention **7 days**, removed by a control-pool step in the existing sweep; no
  data-schema privilege changes.
- Result lookup after reload: the client persists the key before sending;
  `GET .../release-batches/{key}` returns the stored result, or 404 meaning "not
  committed, resend the same key". The release history remains the long-term answer.

Recorded in: SEC-3 section 3.1 (`environmentFrom` gains `"targets"` and `"query"`);
ADR-40 (amendment of 2026-10-29); ADR-41 Note; Q89.

## Further rulings (Q90, Q91)

| #   | Ruling (Code Owner, 2026-10-29)                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Extend `MyAccessResponse` with `capabilities { operations, workspaces, siteConfiguration, authoring }` derived by `decideAccess`; no third grant-exempt route. |
| F2  | Add an integer `revision` to `form_drafts`, bumped on every `PUT /draft`, surfaced in `GET /forms/{id}`.                                                       |
| F3  | Dispose (unflag) is a known-target journey like G05; `docs/webhooks.md` says so.                                                                               |
| F4  | **An aggregate response count is not a SEC-15 read** and writes no row; showing it still needs `response: read` for that form and environment (Q91).           |
| F5  | `TEST_RELEASE_REQUIRED` stays on the default revision until phase 5; `PRIOR_RELEASE_REQUIRED` once configured.                                                 |
| F6  | `GET /forms/{id}.workflow` is deprecated in phase 2 and removed in phase 5 once the wizard reads `release-review`.                                             |
| F7  | `fromEnvironment` stays optional per target, recorded only, never derived from another target in the same batch.                                               |
| F8  | Site configuration is visible to the installation claim only; owners see Workspaces mode.                                                                      |
| F9  | `allows_in_batch` may be true for `prod`; the two-person rule and the draft refusal still apply per target.                                                    |

## Conflicts resolved

| #   | Conflict                                                                                                                                                                 | Ruling                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | ADR-40 amendment 2026-10-26 and `plan/form-publishing-workflow.md` (#1150) bind the release target to the top switch; the plan's wizard chooses explicit destinations.   | **Wizard destinations (Q84).** The environment switch governs operational data in Operations mode only; the publish wizard chooses destinations. ADR-40 amended 2026-10-29. |
| C2  | ADR-40 Q4 "no ordering requirement" versus the 2026-10-26 amendment versus configured prerequisites.                                                                     | Q4 and ADR-40 amended with decision 1: no ordering unless the configured workflow requires one.                                                                             |
| C3  | `apps/api/src/features/releases/README.md` route table named stale scopes.                                                                                               | Fixed in this PR.                                                                                                                                                           |
| C4  | `resolver.ts`, `route-policy.ts` and the ADR-41 Note listed "the environment list" among the claim's `installationOnly` acts; `GET /admin/environments` is grant-exempt. | Fixed in this PR: the fourth act is the erasure log.                                                                                                                        |
| C5  | Plan role table versus code for `forms.approver` non-prod writes.                                                                                                        | No conflict; checked.                                                                                                                                                       |
| C6  | Operations context is explicit, but response and webhook routes read `environmentFrom: "switcher"`.                                                                      | Phase 4 sends the explicit Operations environment as that header; rows stay as they are.                                                                                    |
| C7  | Section 7 of the environments plan said nothing was deferred.                                                                                                            | Rulings recorded as Q84 to Q91 in section 6.                                                                                                                                |

## Dependencies

- Decision 1 before 2, 4 and 5. Decision 3 is independent and phase 2 may start on it.
- Phases 3 and 5 build on Q84 (wizard destinations).
