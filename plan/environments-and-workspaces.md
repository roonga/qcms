# Environments and workspaces

**Status:** decided, not built. The four rulings below are the Code Owner's, taken on 2026-09-25 and recorded verbatim in issue #995. This document is the working record behind **ADR-40** (environments) and **ADR-41** (workspaces) in `docs/adr/core.md`, **SEC-14** in `docs/SECURITY_DESIGN.md` section 5a, and the operator recipe in `docs/deploy-ingress.md`. Nothing here is a decision of its own: where the rulings do not reach, section 6 records the question rather than answering it.

**Order:** environments first, workspaces second. They land independently.

## 1. The problem

QCMS is single-tenant (ADR-04) and has no notion of an environment. A form has one mutable draft (`form_drafts`, one row per form) and immutable published versions (`form_versions`, frozen by the `form_versions_reject_update` trigger in migration 0001), and `getFormBySlug` plus `getLatestPublishedVersion` resolve every public link to the newest published version. A session pins the version it resolved at start and never migrates (ADR-07, invariant I4).

Two things are missing, and they are unrelated to each other:

1. **There is no way to change a form, try it with real respondents, get it approved, and only then make it live.** Publishing is the only way to get a definition onto the serving path, and publishing is immediately live for everyone. The closest thing to a rehearsal today is the admin draft preview (`POST /forms/{id}/draft/preview`), which is a dry run in one browser and involves no respondent, no session and no webhook.
2. **There is no way for two groups inside one organisation to share an installation without seeing each other's forms and questions.** Every authenticated administrator sees the whole library; `user.role` carries `admin` for everyone and nothing reads it for an authorization decision (SEC-3, issue #179).

Multi-tenancy was deliberately not built and stays out (R7). Neither of the two gaps above is a request for it.

## 2. The rulings (Code Owner, 2026-09-25, issue #995)

1. **Environments are release states over immutable versions, in one deployment.** A form version is shared across environments; what varies is which version is released to `test` and which to `prod`. Promotion is a release record (who, when, which version, from which environment), never a copy, so form ids and version numbers stay continuous (R6). Approval is recorded on the release.
2. **Isolation level: a Postgres schema per environment for the data plane.** Control-plane tables (forms, versions, questions, links, admin identity) stay in `public`; the session, answer ledger, submission, delivery and outbox tables exist per environment (`env_test`, `env_prod`) and the API connects with the environment's search path, so Postgres enforces the boundary and no per-query filter can be forgotten. Backups, erasure, exports, the restore drill and observability are per environment. An existing installation migrates to one `prod` environment with its current data.
3. **Test is reachable through secure links only, no public test address.** `/f/{slug}` stays prod. A secure link's server-side row carries the environment as well as the ADR-39 target version. Test webhooks and the outbox are per environment, so a test submission can never fire a production endpoint. In addition the design must let an operator protect test (and any unreleased version) at the network layer: a distinct hostname or listener for test traffic, so ingress and firewall rules can restrict it to an allowlisted network, VPN or identity-aware proxy; per-environment egress rules for webhooks; the draft preview never leaves the admin. Defence in depth: network, then link, then schema.
4. **Workspaces are an authorisation grouping, not tenancy.** A workspace owns forms and questions (with an optional shared workspace for org-wide questions any form may pin); admins are members with a role (owner, editor, approver, viewer), which is where RBAC (issue #179) lands; slugs stay unique per installation; release to prod requires an approver in the workspace who is not the author, configurable per workspace. One operator, one configuration, one identity store, authorisation between workspaces rather than isolation guarantees. ADR-04's Note is updated to say exactly that.

## 3. The target model

```
                     CONTROL PLANE - schema "public", one copy
 +--------------------------------------------------------------------------+
 |  workspaces --- workspace_members --- user / session / account /          |
 |      |  owns                          verification / twoFactor /          |
 |      |                                two_factor_resets                   |
 |      v                                                                    |
 |  questions --- question_versions          environments                    |
 |                                                |                          |
 |  forms ------- form_drafts (mutable)           |                          |
 |      |         form_versions (immutable) <-- form_releases                |
 |      |                                        who / when / which version  |
 |      |                                        / from which environment    |
 |      +-------- secure_links                   / approved by whom          |
 |                 environment + ADR-39 target                               |
 +---------------------------------|----------------------------------------+
                                   |
        cross-schema foreign keys, never copies: a session points AT a
        shared version and AT a shared link row, it does not hold one
                                   |
          +------------------------+------------------------+
          |                                                 |
   DATA PLANE: schema "env_test"                DATA PLANE: schema "env_prod"
 +------------------------------+            +------------------------------+
 | sessions                     |            | sessions                     |
 | answers          append only |            | answers          append only |
 | submissions                  |            | submissions                  |
 | erasure_tombstones           |            | erasure_tombstones           |
 | outbox                       |            | outbox                       |
 | webhooks                     |            | webhooks                     |
 | webhook_deliveries           |            | webhook_deliveries           |
 +------------------------------+            +------------------------------+
   search_path = env_test, public              search_path = env_prod, public
   entry:  secure links only                   entry:  /f/{slug} + secure links
   edge:   restricted hostname (SEC-14)        edge:   the public hostname
   egress: test endpoint hosts only            egress: prod endpoint hosts only
   backup / erasure / export / drill           backup / erasure / export / drill
   are this schema's, separately               are this schema's, separately
```

Three properties are worth reading off the picture rather than deriving them later:

- **One version history.** `form_versions` sits in `public` and both environments point at it. Promotion writes a `form_releases` row and copies nothing, which is what keeps `formId`, `questionId` and version numbers continuous (R1, R6, ADR-02, ADR-18).
- **The only schema boundary is the environment.** Workspaces are entirely inside `public` and are enforced by API-layer checks (SEC-3). A workspace is not a schema and never becomes one, because it is not an isolation guarantee.
- **The two cross-schema foreign keys are load-bearing.** `sessions_form_version_fk` into `public.form_versions` and `sessions.link_id` into `public.secure_links` are what make "shared version, separate data" expressible in the database rather than in a convention. Everything else stays within one schema.

## 4. Migration path for an existing installation

The installation that exists today becomes one environment named `prod`, with its current data, and a second, empty environment named `test`. Nothing is copied, no identifier changes, and no session is re-pinned.

**The steps, in the order a migration has to take them.**

1. `CREATE SCHEMA env_prod` and `CREATE SCHEMA env_test`, owned by the migration role.
2. Move the seven data-plane tables into `env_prod` with their indexes, constraints and triggers: `sessions`, `answers`, `submissions`, `erasure_tombstones`, `outbox`, `webhook_deliveries`, `webhooks`. `ALTER TABLE ... SET SCHEMA` moves a table with its indexes, constraints and triggers attached, so the append-only guarantees travel with the data rather than being re-created after it.
3. Create the same seven tables empty in `env_test`, **with** `answers_reject_update` (migration 0001), `answers_reject_delete` (0004), the `answers_retraction_value` CHECK (0009) and the `outbox_redacted_payload_has_no_answers` CHECK (0016). A new environment without those is an environment whose ledger is mutable, which is why creating one is a migration and not an insert.
4. Add `environments` and `form_releases` to `public`, insert the two environment rows, and write one `form_releases` row per form that has at least one published version, naming its newest version, with `prod` as the environment and no source environment. The first release record then states what was already serving instead of leaving a gap before the feature existed.
5. Add the environment column to `secure_links`, defaulting every existing row to `prod`. An outstanding invitation keeps working and keeps meaning what it meant.
6. Re-point the reporting views (migration 0003) at `env_prod`, and add the `test` set.
7. Extend the "Least-privilege database roles" recipe in `docs/operations.md` with `USAGE` and DML for `qcms_app` on each `env_<name>` schema, and ownership by `qcms_migrate`. `ALTER DEFAULT PRIVILEGES` is keyed on (role, schema, object type), so this is a per-schema step and cannot be inherited from the `public` grant.
8. Give the API its search path. Until this step every process still resolves the moved tables through `public` and finds nothing, so steps 1 to 7 and this one are one deployment, not two.

**Rollback stance.** Steps 1 to 7 are reversible while `test` is empty and no release has been made after the backfill: moving the seven tables back to `public`, dropping the two schemas and dropping the two new tables restores the previous shape with no data loss, because nothing was copied and nothing was rewritten. **The moment a session exists in `env_test`, rollback stops being reversible** and becomes a decision about what to do with that data, because there is no `public` table for it to move back into and merging it into `prod` would put test responses into a production export. So the honest stance is: rollback is a restore from backup, and the forward migration is gated on a drill (`pnpm qcms:drill-restore`) rather than on a down migration that will not exist. This is the same posture the repository already takes toward migrations generally, and the same one `docs/backup-restore.md` opens with: a backup nobody has restored is not a backup.

## 5. What the network design adds

Recorded here only as the shape; the control is SEC-14 (`docs/SECURITY_DESIGN.md` section 5a) and the recipe is the "Restricting the test environment" section of `docs/deploy-ingress.md`.

- A **third hostname** for test traffic, so an ingress and a firewall have something to act on. Host-based at the edge, and the anonymous entry route unmounted in a test-serving process (ADR-09), because the first is the only half infrastructure can express and the second is the only half that survives a misconfigured edge.
- An **allowlist** on that hostname: source network, VPN or identity-aware proxy. The public address is prod only.
- **Per-environment egress** for webhook delivery, stating in firewall vocabulary what the schema split already guarantees.
- A **firewall rule table** by source, destination, port and environment, in SEC-14 and nowhere else, using only ports from `docs/PORTS.md` (R8).
- **What it does not buy:** an insider already on the allowed network, and a leaked test link, are the link layer's problem; a handler that queries the wrong environment is the schema layer's. Defence in depth in that order, network then link then schema.

## 6. Open questions for the Code Owner

Every one of these is a question this document hit and did not answer. The ones marked **blocking** have to be settled before the task named beside them can start; the rest can be settled during it.

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Bears on         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Q1  | **Are `test` and `prod` the only two environments, or is the set configurable?** A configurable set means creating an environment is DDL, and `qcms_app` holds no `CREATE` and no DDL at all (SEC-10), so it can never be an admin action: it is a migration or an operator step with the migration credential. Recommended: fixed at two for phase A, with the table shaped so a third is a migration rather than a redesign.                                              | **blocking 064** |
| Q2  | **Which process serves which environment?** One API process holding one pool per environment, or one process per environment. The second is cleaner (a search path is a connection property, not a request property) and doubles the standing container count, which is an ADR-20 amendment; the first keeps ADR-20 intact and puts the environment on a pool selection inside the process. Also interacts with the enterprise mount split (`api-public` / `api-internal`). | **blocking 064** |
| Q3  | **Where does `webhooks` live?** ADR-40 places it per environment, because "a test submission can never fire a production endpoint" is a Postgres guarantee only if the test deliverer cannot see a prod endpoint row. The cost is that endpoint configuration is authored once per environment rather than shared, and promotion does not carry it. Confirm, or rule for a `public` table with an environment column and accept a filter.                                   | **blocking 064** |
| Q4  | **Must a version be released to `test` before it can be released to `prod`?** The release record carries "from which environment", which makes a path recordable but does not require one. Recommended: not required, recorded when it happened, because a hotfix to prod is a real case and a rule that forbids it will be worked around.                                                                                                                                  | 065              |
| Q5  | **What does a release do to open sessions on the previously released version?** **Nothing**, and ADR-07 already says so: a session pins the version it resolved at start and stays on it for its lifetime (invariant I4, no re-pin path exists). Recorded here for confirmation rather than as an open design point, because it is the first thing a reader will ask.                                                                                                       | 065              |
| Q6  | **How does the admin show which environment it is looking at?** One admin serves both, and response lists, exports, erasure and link minting are all per environment. A global switcher, a per-screen selector, or two screens. This is a design call with a real safety edge: an erasure performed against the wrong environment is not undoable.                                                                                                                          | 065, 067         |
| Q7  | **Does an erasure request span environments?** A respondent who answered in `test` and in `prod` has two sessions in two schemas and two tombstones. One request erasing both is what a data subject means; two separate acts is what the schema split naturally gives. ADR-17 is form-scoped and silent on this.                                                                                                                                                           | 067              |
| Q8  | **Does the CSV export name the environment?** Adding a column changes a file adopters parse. Naming it in the filename instead changes nothing machine-readable. Either way the formula-injection guard in `@roonga/qcms-csv` (issue #470) applies unchanged.                                                                                                                                                                                                               | 067              |
| Q9  | **How do `pnpm dev:up`, the e2e harness and the scaffold get their environments?** Concretely: does the Compose stack create both and publish only prod; does the Playwright suite run against `prod`, against `test`, or both; does `pnpm up:e2e` assert the test hostname is unreachable; does `pnpm qcms:drill-restore` drill both schemas; and does `create-qcms-app` stamp one environment or two?                                                                     | 064, 067         |
| Q10 | **Are reporting views per environment, and what are they called?** `reporting.responses` and `reporting.answers_flat` (migration 0003) read data-plane tables. Options are a view set per environment schema, or a `reporting_<env>` schema per environment. The `qcms_ro` recipe in `docs/reporting-view.md` moves with the answer, and an existing BI tool breaks either way.                                                                                             | 067              |
| Q11 | **Is deployment configuration per environment?** `QCMS_RL_*`, `QCMS_SESSION_TTL_MS`, `QCMS_ANTIABUSE_*`, the challenge provider and retention TTLs are installation-wide and typed (ADR-24). Test could reasonably want shorter retention and no challenge. Making any of them per environment is an ADR-24 question, not a configuration one.                                                                                                                              | 066, 067         |
| Q12 | **Does the installation-wide SEC-3 `admin` claim survive alongside workspace roles, and what may an administrator with the claim but no membership do?** Today every authenticated administrator sees everything. "Nothing" is the clean answer and locks out the operator who created the first account; "everything" makes workspaces advisory.                                                                                                                           | **blocking 069** |
| Q13 | **What is the default for approver-not-author on a new workspace, and for the single workspace an existing installation migrates into?** Defaulting it on for a migrated installation with one administrator makes prod releases impossible until a second account exists.                                                                                                                                                                                                  | 070              |
| Q14 | **Can a question move between workspaces, and what happens to forms elsewhere that already pin a version of one leaving the shared workspace?** Existing pins keep serving under ADR-02 and R6; the question is whether the move is refused, allowed with existing pins grandfathered, or allowed with new pins gated the way `deprecated` already is.                                                                                                                      | 068              |
| Q15 | **Is a workspace deletable, and what happens to its forms, responses and released versions?** Archival, reassignment or refusal. ADR-17 makes whole-session deletion a narrow, sanctioned path, so "delete a workspace" cannot be allowed to become a third door.                                                                                                                                                                                                           | 068              |
| Q16 | **Is the environment visible to a respondent?** Recommended: no. The token carries nothing about it (the environment is on the row, like the ADR-39 target), and the hostname already differs, so a respondent sees a different address and nothing else. Confirm, because a visible environment in a portal string is a decision that cannot be quietly reversed later.                                                                                                    | 066              |

## 7. Task breakdown

Stage 9, Phase 4. None of this gates launch (038), and no existing task is renumbered. **Task 063 (link version targeting) and task 066 touch the same `secure_links` row**, so whichever lands second rebases onto the other rather than re-deciding the row's shape; ADR-39 now carries a Note saying so.

Gates are named per task. Every task runs `pnpm verify`. A task touching Docker-backed suites also runs the forced run (`pnpm exec turbo run test --force`, confirming `Cached: 0`) and, where it changes the boot environment, `QCMS_PORT_SEAT=<0-9> pnpm up:e2e`. A task touching `apps/portal`, `apps/admin` or `@roonga/qcms-ui` also runs `QCMS_PORT_SEAT=<0-9> pnpm verify:browser`, detached.

### Phase A - environments

**064 - Environment model, schema-per-environment data plane, and the prod migration.** Depends on 038; blocked on Q1, Q2 and Q3; Q9 settles during it.

Deliverables: the `environments` table; the migration that creates `env_prod` and `env_test`, moves the seven data-plane tables with their indexes, constraints and triggers, and creates the empty second set; the search-path selection in the API and its configuration; the per-environment grants in the `docs/operations.md` role recipe; `packages/db` schema modules split so the generator emits both sets.

Exit criteria: (1) an existing database migrates to `env_prod` with every row, index, constraint and trigger intact, asserted against a real Postgres; (2) `env_test` carries the same append-only guarantees, asserted by the same suite that asserts them today; (3) a statement issued under one environment's search path cannot read or write the other's tables, asserted rather than reasoned; (4) `qcms_app` can read and write both and can create neither; (5) no identifier and no version number changes.

Gates: `pnpm verify`, forced Docker-backed run, `pnpm up:e2e`.

**065 - Release records and promotion.** Depends on 064; Q4, Q5, Q6 settle during it.

Deliverables: `form_releases`; the release and promotion API on the admin surface; the backfill of one release row per published form; the admin screens that show what is released where and promote between environments; release resolution replacing "newest published version" on the respondent path.

Exit criteria: (1) a form version released to `test` and not to `prod` is served in `test` and not in `prod`; (2) promotion writes a row and copies nothing, with the form id and version number unchanged; (3) a release never re-pins a live session (ADR-07, I4), asserted with a session open across a release; (4) the release history answers who released what, when, from where, and with whose approval; (5) the admin states which environment each screen is showing.

Gates: `pnpm verify`, `pnpm verify:browser`, forced Docker-backed run.

**066 - Environment-scoped secure links and test entry.** Depends on 064 and 065; coordinates with 063; Q11, Q16 settle during it.

Deliverables: the environment on the `secure_links` row; minting a link for an environment; redemption starting a session in that environment; the test-serving process not mounting anonymous entry; the portal's test host shape; the SEC-14 operator recipe exercised.

Exit criteria: (1) a prod link starts a prod session and a test link a test session, with the token format unchanged; (2) there is no anonymous entry to `test` on any address, asserted as a `404` and not a `403` (ADR-09); (3) revocation, expiry, one-time consumption, the challenge and the whole-form closed state all behave as they do today, per environment; (4) an existing link continues to resolve `prod`; (5) a respondent's experience is unchanged.

Gates: `pnpm verify`, `pnpm verify:browser`, `pnpm up:e2e`.

**067 - Per-environment delivery, retention and operations.** Depends on 064 and 065; Q6, Q7, Q8, Q9, Q10, Q11 settle during it.

Deliverables: the outbox, endpoints and deliveries per environment; the deliverer and retention sweep running per environment; erasure, export and the reporting views per environment; `docs/backup-restore.md`, `docs/erasure.md`, `docs/reporting-view.md` and `docs/operations.md` updated; the environment as an allowlisted telemetry attribute (SEC-13); the restore drill covering both schemas.

Exit criteria: (1) a test submission cannot reach a prod endpoint, asserted against a real Postgres rather than argued; (2) backup, restore and the drill cover every environment; (3) an erasure and an export name their environment and touch no other; (4) the retention sweep runs per environment and ages nothing across one; (5) a trace can be attributed to an environment, and the attribute names no respondent.

Gates: `pnpm verify`, forced Docker-backed run, `pnpm up:e2e`, `pnpm qcms:drill-restore`.

### Phase B - workspaces

**068 - Workspace model and ownership of forms and questions.** Depends on 038; independent of phase A; Q14 and Q15 settle during it.

Deliverables: `workspaces`; the workspace reference on `forms` and `questions`; the shared workspace and the publish-time rule on which question versions a form may pin; the unique constraint on `forms.slug` that does not exist today; the migration placing every existing form and question into one workspace.

Exit criteria: (1) every form and question has exactly one workspace after migration; (2) publish refuses a pin to a question owned by another non-shared workspace; (3) slugs are unique installation-wide, enforced by the database and not by authoring convention; (4) no published version changes and no public address moves.

Gates: `pnpm verify`, forced Docker-backed run.

**069 - Workspace membership, roles and API enforcement.** Depends on 068; blocked on Q12.

Deliverables: `workspace_members` and the four roles; enforcement in the API layer per route group and per route (SEC-3, never a BFF, never only the UI); the membership screens; the SEC-3 authorization matrix in `docs/SECURITY_DESIGN.md` section 3.2 extended, with `apps/api/e2e/security/01-authorization-matrix.e2e.ts` and `matrix-coverage.e2e.ts` moving with it.

Exit criteria: (1) each of the four roles is probed against every authoring, response and configuration action; (2) an administrator with no membership reaches nothing in that workspace; (3) enforcement is in the API and a BFF or UI bypass reaches a refusal, asserted; (4) the section 3.2 table and the probe inventory stay in step, which `matrix-coverage.e2e.ts` already enforces.

Gates: `pnpm verify`, `pnpm verify:browser`, forced Docker-backed run.

**070 - Approver-not-author release approval.** Depends on 065 and 069; Q13 settles during it.

Deliverables: the per-workspace setting; the check at release to `prod`; the approval recorded on the ADR-40 release record; the admin flow that asks for it.

Exit criteria: (1) with the setting on, a release to `prod` by the version's author is refused, and by a different approver in the same workspace succeeds; (2) the approval is on the release row and is readable in the history; (3) with the setting off, behaviour matches 065 exactly; (4) an approver from another workspace is refused.

Gates: `pnpm verify`, `pnpm verify:browser`.

## 8. Non-goals

Multi-tenancy (R7, ADR-04). A second database, a second deployment, or replication between environments. Per-workspace configuration, theming or ports. A workspace segment in any URL. An environment visible in a token. Copying a version between environments, in any form: promotion is a record, and a copy would break R1, R6 and ADR-18 at once.
