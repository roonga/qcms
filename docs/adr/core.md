# Core decisions

**Status:** authoritative. Part of the decision record indexed in [`README.md`](README.md). These decisions bind the engine, the data model, the API, the platform, both frontends, or the development process. Portal-only decisions live in [`portal.md`](portal.md); admin-only decisions in [`admin.md`](admin.md).

---

## Domain model and rules

### ADR-01 - Domain-first compiled UI

**Status:** implemented.

**Decision.** `FormDefinition` is the source of meaning. A pure compiler projects each published snapshot to A2UI documents. Storage and rendering consume those outputs and never redefine domain behavior.

**Note.** The compiler also emits one non-domain node per step (the ADR-12 honeypot decoy), and it also runs outside publish for the admin draft preview, whose output is not the ADR-18 audit copy.

### ADR-02 - Versioned question library

**Status:** implemented; text corrected 2026-08-31.

**Decision.** Questions are governed, versioned entities. `questionId` is stable identity, a **published** question version is immutable content, and published forms pin exact question versions.

**Note.** The earlier text read "versions are immutable content" without qualification. Draft versions are edited in place by design, and a `deprecated` state exists: existing pins keep serving, new pins are gated.

### ADR-03 - Closed rules DSL

**Status:** implemented.

**Decision.** Branching uses a closed, typed JSON DSL. New operators are versioned core changes. The format must remain machine-emittable and publish-time validatable.

**Note.** Two artifacts now enforce the closed set, one per side. `packages/core/src/visibility-rule.test.ts` pins the thirteen operators as a hand-edited list checked against the `Condition` union, so adding one is a deliberate edit rather than a diff nobody reads. `apps/admin/lib/forms/condition.ts` ties the admin's parallel copy of the set to the same union through a **type-only** import of `Condition`, which R2 permits because it is erased at compile time and carries no kernel code into the app; a new operator in core therefore fails the admin's typecheck. Neither side can move alone.

**Note (flagged).** There is still no DSL **version** constant, and `@roonga/qcms-core` has never been published, so "versioned core change" remains a review convention rather than a released number.

### ADR-07 - Pinned sessions and submission lock

**Status:** implemented.

**Decision.** A session pins one published form version for its lifetime. Answers append to a ledger. Submission validates visible required questions, excludes hidden answers, and locks the resulting answer set.

**Note.** The lock is enforced by the API and session status, not a database trigger; post-submit updates touch only the moderation flag, never the locked answer set or its hash.

### ADR-11 - Localizable content model

**Status:** implemented.

**Decision.** Human-readable domain content uses `LocalizedText`. Published snapshots carry localized content; application chrome uses app catalogs. Launch may ship one locale, but adding locales must not require a schema migration.

**Note.** True of the content model; the stored compiled copy is single-locale (one compiled document set per form version), so the Phase 4 runtime locale switcher (ADR-27) will need a per-locale compile or a schema change - a decision deferred with it. `resolveText` has no language-only fallback (`en-AU` does not fall back to `en`).

### ADR-14 - Step resolver seam

**Status:** implemented.

**Decision.** `StepResolver` is the compiler extension seam. The shipped resolver is pure and deterministic. Future adaptive behavior must preserve the stored-output contract and cannot put an LLM in the serving path.

**Note.** Today's `StepResolverContext` carries no answers, so an answer-adaptive resolver needs a widened seam; the code acknowledges this as a later seam version.

### ADR-16 - Forward-only rule evaluation

**Status:** implemented; see note.

**Decision.** Rules evaluate once, in document order. A rule may show only targets that appear after every question it reads. Publish rejects backward targets and cycles. A semantic change requires a new snapshot `semanticsVersion`.

**Note.** The `semanticsVersion` gate runs on the serve and answer paths as well as at submit (issue #723, PR #742): `apps/api/src/features/responses/serve-step/handler.ts` reads the stored stamp through `parseSemanticsVersion` and refuses a snapshot recorded under superseded semantics before the evaluator sees it, so such a snapshot fails at entry rather than only at submit. The stamp is stored as text and parsed on every path that reads it. The evaluator still implements exactly one version at a time, so multi-version evaluation remains unbuilt.

**Amendment - required means non-blank (Code Owner, 2026-08-31, issue #128).** A question is answered when it holds a **non-blank** value: an empty or whitespace-only text value is absence, for the `answered` operator, for every value operator, and for the required accounting alike. The stored value is never rewritten - trimming decides the presence test only, so a respondent's `" "` stays verbatim in the ledger and in exports.

This was corrected **within `semanticsVersion` 1** rather than under a bump, and the reasoning is part of the decision. A bump cannot deliver what this ADR's rule protects: the evaluator implements one version at a time and refuses any other stamp, so `2` would not preserve old snapshots' behavior, it would make every published snapshot fail at submit. Multi-version evaluation is the missing prerequisite, and it is the limitation noted above. Against that, no answer the product can produce changes meaning: both control boundaries have reported an emptied field as absence since issue #98, and the same batch made `""` and `[]` unstorable at the API (ADR-33). One golden scenario that had pinned `""` as answered was amended in place; `packages/core/golden/evaluator/CORPUS.md` records that as a defect-correction precedent and not as licence to edit a golden that disagrees with an intended semantics change.

### ADR-21 - Multi-choice comparison

**Status:** implemented.

**Decision.** Multi-choice equality is set equality. `contains` tests one option and `containsAny` tests a set of options. Publish rejects those operators against non-multi-choice questions.

### ADR-32 - Authored validation messages

**Status:** implemented.

**Decision.** Authors may supply localized messages per question constraint. Blank fields inherit catalog defaults. Stable validation codes remain authoritative; authored messages are presentation content compiled into the form document.

**Note.** The portal routes authored messages by `constraint`, not `code`; the catalog carries one generic fallback rather than per-code entries. The authorable key set is not identical to the constraint set (`required` is authorable but not a constraint; `encoding` and `options` are constraints but not authorable).

### ADR-33 - Answer retraction

**Status:** implemented.

**Decision.** Clearing an answer appends a retraction record; it never mutates an answer row. Latest-answer reads resolve a retraction to unanswered for rules, validation, reporting, and export. Empty text and empty selections are absence, not answers. Whole-session deletion remains governed by ADR-17.

**Note.** "Empty is absence" is enforced at the control boundary (the renderer and the no-JS decoder) _and_, since issue #128's batch, in the kernel: `validateAnswer` refuses `""` and `[]` with `EMPTY_ANSWER_NOT_ALLOWED`, so a direct API post of either is a 422 that stores nothing and whose message names the `null` retraction as the way to clear an answer. The refusal is never a silent conversion into a retraction - clearing keeps exactly one spelling on the wire. Whitespace-only text is a separate rule: it is stored as typed and denied _presence_ instead (issue #128, ADR-16 note). A retraction of a never-answered question is a no-op and appends nothing.

### ADR-36 - Authored boolean labels

**Status:** implemented.

**Decision.** Boolean questions may provide localized `yesLabel` and `noLabel` values with catalog fallback. Stored answers remain booleans and rule, reporting, and export semantics do not change.

**Note.** The fallback source is a compiler lexicon constant frozen by `compilerVersion`, not an app catalog in the ADR-11 sense.

## Serving and audit

### ADR-18 - Serve the stored audit copy

**Status:** implemented.

**Decision.** The portal serves the compiled A2UI documents stored at publish time. Each form version records compiler, A2UI spec, and rule-semantics versions. Golden documents and renderer compatibility are append-only.

**Note.** The CI append-only guard covers the compiler golden corpus (`packages/a2ui-compiler/golden/v*`); the evaluator corpus (`packages/core/golden/evaluator/`) is append-only by prose only.

## API and platform

### ADR-04 - Single-tenant core

**Status:** implemented.

**Decision.** QCMS ships as a single-tenant deployment. Multi-tenancy is a derivative recipe, not a schema or runtime cost imposed on the core.

**Note.** Verified: no tenant concept exists in schema or runtime. The derivative recipe itself is not yet written; no such document exists under `docs/`.

**Note - the workspace reading (Code Owner, 2026-09-25, issue #995).** ADR-41 adds workspaces, and this Note records what they do and do not do to this decision, so a reader does not have to infer it. A workspace is an **authorisation grouping between groups sharing one installation**: one operator, one configuration, one identity store, one database, one deployment, with authorisation between workspaces rather than isolation guarantees. It is not multi-tenancy and does not make this decision partly true. The one schema boundary QCMS has is ADR-40's environment, which separates data planes within a single tenant's own deployment; it is not a tenant boundary either. Multi-tenancy stays out (R7), and the derivative recipe named above stays unwritten.

### ADR-09 - Route groups are topology controls

**Status:** implemented.

**Decision.** API route groups are mounted explicitly. An unmounted group does not exist and returns 404 rather than relying on an authorization check.

**Note.** Four groups ride three mount flags (the auth group mounts with `admin`), and mounting also installs the SEC-4 internal-token gate, so a mount is a topology control plus a channel gate.

**Note - ADR-40 needs a mount this record does not have yet (issue #995).** SEC-14 rests on this decision twice, and only one of the two mechanisms exists. An environment's respondent surface as its own mountable group is the straightforward case: an unmounted `test` surface is a 404 exactly as this record says. **Anonymous entry is not, today.** Anonymous and secure-link entry are one route, `POST /sessions` on the `public` group, discriminated by a body refine ("Provide exactly one of formSlug or token"), so "no anonymous entry to test" cannot currently be a routing fact and would be a handler refusal instead. Making it structural means splitting that route so the two entry modes can ride different mount decisions, which changes the count in the Note above. Task 066 owns that split and the amendment to this Note; until it lands, read SEC-14's 404 claim as what has to be built rather than as what holds.

### ADR-10 - Reporting before public API

**Status:** implemented.

**Decision.** Launch integrations are signed webhooks, exports, and documented read-only reporting views. A stable `/api/v1` pull API is Phase 4.

**Note.** "Read-only" for the reporting views is an operator GRANT recipe (`docs/reporting-view.md`), not a shipped role migration.

### ADR-13 - Fetch-pure vertical slices

**Status:** implemented.

**Decision.** The Hono API uses fetch-pure vertical slices with explicit dependencies. Multi-field and multi-row invariants live in core functions; other work uses plain transaction scripts. Background delivery and retention jobs run inside the API process.

**Note.** The schedulers start only where the internal surface is mounted (in the solo topology, always). Fetch purity is lint-enforced for `@roonga/qcms-core` and the compiler but convention-only in `apps/api`. Retention now runs three rules: the session sweep plus the aged redaction of response snippets (#304) and outbox payloads (#329).

### ADR-15 - Runtime baseline

**Status:** implemented.

**Decision.** QCMS targets Node LTS. Experimental runtime flags are not part of the supported execution model.

### ADR-17 - Erasure, retention, and outbox copies

**Status:** implemented; amended 2026-08-02 (task 059) and widened by issues #304 and #305.

**Decision.** Erasure is form-scoped and, in one transaction: deletes the session's answer ledger and submission, retains the session row as a scrubbed shell, writes a content-free tombstone, redacts QCMS's outbox payload and every stored delivery response snippet, and cancels undelivered deliveries. Delivered or in-flight downstream copies cannot be recalled. Retention purge is the other sanctioned whole-session delete path and leaves no tombstone because the session was never submitted; the retention scheduler also ages out outbox payloads and response snippets on time limits. `docs/erasure.md` is the operational contract.

**Note - erasure is per environment, with a cross-environment hint (Code Owner, 2026-09-26, issue #995, ADR-40).** Once the data plane is a schema per environment, an erasure acts in **the currently selected environment only** and never crosses an environment boundary in one act, so `prod` cannot be reached from `test` by accident and the confirmation restates which environment it is about. That is the safety property, and it is bought at a real cost: a data subject's request is not one click. So when the same subject identifier also has sessions in other environments, the screen **says so and offers to repeat the erasure there**, each repetition its own confirmed act in its own environment. The request is completed deliberately, environment by environment, and the tombstones that result are per environment like the sessions they describe. Task 067 builds it; this decision's transaction and its contents are unchanged.

### ADR-24 - Typed deployment flags

**Status:** implemented; see note.

**Decision.** Deployment flags are declared in a typed environment registry and parsed at boot. Unknown or malformed flags fail fast. Clients receive behavior, not flag values. Per-form settings are domain configuration, not feature flags.

**Amendment - a named, small set of settings is per environment (Code Owner, 2026-09-26, issue #995, ADR-40).** With environments (ADR-40) two settings are worth varying per environment and the rest are not, so this decision is amended to name the set rather than opened in general. **Per environment:** the retention TTLs and the challenge provider. A test environment that keeps responses for thirty days, or that asks a tester to solve a visible challenge, is a cost with no benefit. **Installation-wide, unchanged:** rate limits, the session TTL, anti-abuse thresholds, ports, themes, keys and every other typed setting. The per-environment values are set through the operator command that creates and manages environments, not through the process environment, because they are properties of an environment row rather than of a process; the typed registry and its fail-fast boot parsing are untouched for everything it already covers, and "clients receive behavior, not flag values" holds for both sets.

**Note.** "Clients receive behavior, not flag values" is absolute; the Code Owner removed the one standing exception on 2026-08-31 (issue #725). The admin form-settings response used to echo the raw `challengeProvider` flag value. It now carries a derived boolean, `challengeEnforceable`, true exactly when a real provider is configured, and the settings panel warns when a form sets `challengeRequired` while `challengeEnforceable` is false. The panel therefore reads a behavior statement and never a provider name, so adding or renaming a provider changes nothing the admin sees. The registry covers feature flags only; the rest of the environment is typed and fail-fast but hand-parsed, and unknown-key rejection fires only on the `QCMS_FLAG_` prefix.

**Widened on 2026-09-12 (Code Owner).**
The rule reaches **any environment identifier in a response body**, not only the `QCMS_FLAG_` registry the paragraph above scopes unknown-key rejection to.
The two are different questions and the note read as one: the registry decides which names are parsed and rejected at boot, while this decision is about what a client is told, and a variable a client cannot set is no more actionable for being outside the registry.
PR #908 applied the widened reading to the webhook refusal prose, where the `https-required` and `private-host` messages ended "set QCMS_WEBHOOK_ALLOW_PRIVATE for on-prem targets" in a 422 body (issue #756, from #312).
Issue #910 closed the other known instance and **turned the rule into a gate**, which is what the note above could not do: `apps/api/src/features/auth/instance.ts` ended an `APIError` body with "set QCMS_ADMIN_PASSWORD_BREACH_CHECK=false", and the outage now answers the same `503 BREACH_CORPUS_UNREACHABLE` with operator-neutral prose while the variable goes to the API's warn log and to `qcms:create-admin`'s stderr.
The **stable machine code came first and is unchanged**, which is why no client had to move: the admin's change-password classifier (`apps/admin/lib/server/password-refusal.ts`) and the bootstrap CLI both keyed on the code already, so rewording the sentence changed nothing either of them decides, and tests on both sides now assert that independence rather than leaving it to be inferred.
A **third** instance surfaced the moment the gate existed, and is fixed in the same change: the assist stream's `STEP_LIMIT` event ended "raise QCMS_AGENT_MAX_STEPS", framed straight into an SSE response body by `apps/api/src/features/forms/assist/handler.ts`.
That is the argument for the gate rather than a third review catch. `scripts/check-security-hygiene.mjs` now refuses a `QCMS_` token in any string literal that reaches a response body under `apps/api/src`, following one hop through a named constant because that is how #910 hid from a scan of argument literals; operator channels (a logger line, a boot refusal, a CLI line, a bare environment read) are deliberately untouched, since naming the variable there is the point.
So this note records a clean tree, checked by CI rather than by reading.

### ADR-35 - API-only database access

**Status:** implemented; amended 2026-07-31 (task 056).

**Decision.** The API is the only application process with a database handle, including better-auth storage. Admin and portal have no database dependencies or credentials and reach data through BFF calls. Auth endpoints are explicitly allowlisted; self-registration is absent.

### ADR-40 - Environments are release states over shared versions

**Status:** decided; not built (task 064). Code Owner rulings of 2026-09-25 and 2026-09-26, issue #995. Nothing in this record is open: the decision queue for #995 closed on 2026-09-26, and `plan/environments-and-workspaces.md` section 6 records every question with its answer.

**Decision.** A deployment has named **environments**. An environment is a release state over the one immutable version history, never a second copy of it.

**The set is configurable, and changing it is an operator act.** A fresh database is created with exactly two environments: `test` and `prod`. Further environments are created and removed by an **operator command run under the migration role**, never by an administrator and never over HTTP, because creating and dropping a schema is DDL and `qcms_app` holds none (SEC-10). It is the same family as `qcms-db-migrate`, `qcms:create-admin` and `qcms:reset-2fa`: a command against the database, guarded by possession of the migration credential. Every per-environment job, export, backup, retention pass, reporting view and telemetry attribute therefore **enumerates the live set** rather than a compiled-in pair, so a third environment is a command and not a code change.

A form version is published once and is shared by every environment (ADR-18). What varies per environment is which published version is **released** there. Promotion is a **release record**, never a copy, so `formId`, `questionId` and version numbers stay continuous across environments (R1, R6, ADR-02). Approval is recorded on the release.

**The release record.** One append-only control-plane row per release, naming the environment, the form, the released version, the environment it was promoted from (absent for a first release), the administrator who released it, the approval recorded with it, and the time. The currently released version of a form in an environment is the newest such row for that pair; nothing else decides it.

**The release state carries the closed value, so a form is open or closed per environment.** Closing intake in `prod` while a test run continues, and the reverse, are ordinary operations, so "closed" cannot be one column on the form: `forms.status` and its `form_status` enum go away, or become a value derived from the release states. ADR-39's "the whole-form closed state overrides every public and secure link" becomes **the environment's** closed state overriding every link into that environment, which is the amendment recorded on that decision. A version need not be released to `test` before `prod`, and the release record's source environment makes the path auditable when there was one, so a hotfix straight to `prod` is allowed rather than worked around. This row is the audit answer to "what was serving in `prod` on that date, and who put it there", which today's `form_versions.published_at` cannot give, because publishing and releasing are now separate acts.

**Releasing never moves an open session.** A session pins the version it resolved at start and stays on it for its lifetime (ADR-07, invariant I4). A release changes only what a session started **after** it resolves, in that environment alone.

**The data plane is isolated by a Postgres schema per environment, and the control plane has a named schema of its own.** Both planes are named by role with the environment as a suffix, so `control`, `data_test` and `data_prod` read as one scheme rather than two, and a per-environment schema is found by `data_%` rather than by a list. Every QCMS object lives in a schema QCMS named, and `public` is left empty. The split is exact:

| Schema                                 | Holds                                                                                                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `control`, one copy                    | `questions`, `question_versions`, `forms`, `form_drafts`, `form_versions`, `secure_links`, `user`, `session`, `account`, `verification`, `twoFactor`, `two_factor_resets`, and the two tables this decision adds: `environments` and `form_releases` |
| `data_<env>`, one per environment      | `sessions`, `answers`, `submissions`, `erasure_tombstones`, `outbox`, `webhook_deliveries`, `webhooks`                                                                                                                                               |
| `reporting_<env>`, one per environment | the view set, one per environment (`reporting_prod.responses`, `reporting_test.responses`), replacing the single `reporting` schema of migration 0003                                                                                                |
| `public`                               | **nothing.** Off every search path, and `CREATE` on it granted to nobody                                                                                                                                                                             |

**Three** foreign keys cross from the data plane into the control plane, and the first two are what make a shared version history work with no copying:

| Constraint                                 | From                  | Into                    |
| ------------------------------------------ | --------------------- | ----------------------- |
| `sessions_form_version_fk`                 | `data_<env>.sessions` | `control.form_versions` |
| `sessions_link_id_secure_links_link_id_fk` | `data_<env>.sessions` | `control.secure_links`  |
| `webhooks_form_id_forms_form_id_fk`        | `data_<env>.webhooks` | `control.forms`         |

The third is the price of putting `webhooks` on the per-environment side (migration 0006 declares it). It is named here rather than left to be discovered, because a per-environment table referencing a control-plane one is the shape a migration author has to get right N times. The remaining four foreign keys stay inside one schema: `answers_session_id_sessions_session_id_fk`, `submissions_session_id_sessions_session_id_fk`, `webhook_deliveries_outbox_id_outbox_id_fk` and `webhook_deliveries_webhook_id_webhooks_webhook_id_fk`. `erasure_tombstones` keeps its deliberate absence of a foreign key and is per environment because it records a session that lived in one.

**The API selects an environment by search path, not by a predicate.** A connection is opened with `search_path` set to `data_<env>, control`, so every unqualified data-plane name resolves inside exactly one environment's schema, every unqualified control-plane name resolves in `control`, and there is no per-query filter for a handler to forget. `public` is not on the path, so an unqualified name can never resolve to something a tool, an extension or a careless session created there. A request is served under exactly one environment for its whole lifetime, chosen before any data-plane statement runs. This is the same mechanism migration 0003's `reporting` schema already uses, applied to the operational tables.

**The schema is a resolution boundary and a privilege boundary, and the two are separate mechanisms.** Resolution comes from the search path: there is no filter to omit, so an omission is not expressible. That alone would not stop a **schema-qualified** statement, because `search_path` is a default and not a grant, so `select ... from data_prod.answers` would succeed from a `data_test` connection held by a role with DML everywhere.

So there is **one application role per environment**: `qcms_app_test`, `qcms_app_prod`, and one for every environment the operator command creates. Each is granted `USAGE` and DML on `control` and on its own `data_<env>` and on nothing else, so a schema-qualified read of another environment's data table fails on **permission** rather than on resolution. The one API process holds one pool per role, which is what makes the two mechanisms line up: a pool is a connection, a connection is a role, and a role is an environment. The environment command creates the role and its grants under the migration role, because a `CREATE ROLE` is as far outside an application role's rights as a `CREATE SCHEMA` (SEC-10).

**Test is reachable through secure links only.** `/f/{slug}` stays the `prod` address, as does `/f/{slug}/v{version}` when ADR-39 lands. No public non-prod address exists, and `/<env>/f/{slug}` is not a route. A secure link's server-side row carries the **environment** alongside the ADR-39 target version, so redeeming a link decides both which environment the session lands in and which version it resolves; the environment rides the row and not the token, exactly as the target does, and a signature alone remains insufficient (SEC-2).

**A non-prod address carries the environment's name as its first path segment; a `prod` address carries no prefix.** Every address under a non-prod environment is `/<env>/...`, on the portal and on the API alike, so a test secure link reads `/test/l/{token}` and there is no unprefixed test address anywhere. `prod` is the unprefixed shape, which is why every link that exists today keeps working and why production has exactly one address shape rather than two spellings of one thing. Three properties follow and are the reason for the rule:

- **A respondent, a tester or an operator can tell from the link itself that it is not production.** That is the whole point, and it is the one property no server-side field can deliver, because nobody reads a database row before clicking a link.
- **The path is a second network handle.** An ingress or an L7 firewall can allow or deny `/<env>/` on its own, without resolving a hostname or reading a body (SEC-14).
- **The environment is still not in the token.** The path names it, the server-side row decides it, and a token presented under the wrong prefix is **refused** rather than redirected or silently honoured. So the prefix is a routing and legibility fact, and the authority remains the row, exactly as ADR-39 holds for the target version.

Because the environment set is configurable, the prefix is the environment's own name, which makes that name a URL path segment. It therefore has to be a legal path segment and a legal Postgres identifier inside `data_<env>`, and the environment command must refuse a name that collides with a route either surface already serves at its root. The reserved set and its derivation are task 064's, in `plan/environments-and-workspaces.md`.

**A small set of configuration is per environment; everything else is installation-wide.** Retention TTLs and the challenge provider may be set per environment, through the operator command that owns environments, because a test environment that keeps responses for thirty days or asks a tester to solve a challenge is a cost with no benefit. Rate limits, the session TTL, anti-abuse settings and every other typed setting stay installation-wide. ADR-24 is amended narrowly to name that set rather than opened to per-environment configuration in general.

**Delivery and operations are per environment.** The outbox, the webhook endpoints and the delivery rows live in the environment's schema, so a `test` submission cannot reach a `prod` endpoint through any code path rather than through a filter that holds. Backup, restore and the restore drill, erasure, response export, the retention sweep and the reporting views are per environment, and the environment name is an allowlisted span and log attribute (SEC-13) so a trace can be told apart from one in another environment. The attribute names a deployment configuration and no respondent, which is why it is allowlistable at all.

**The network layer is part of the design and is the operator's to configure.** QCMS must let an operator put test traffic on a distinct hostname or listener so ingress and firewall rules can restrict it to an allowlisted network, and must scope webhook egress per environment. The control is **SEC-14** (`docs/SECURITY_DESIGN.md` section 5a) and the operator recipe is `docs/deploy-ingress.md`. Defence in depth, in order: network, then link, then schema. TLS, HSTS and routing remain operator-provided ingress (ADR-20); what QCMS owns is the distinguishable listener, the per-environment egress rule set and the link and schema layers behind them.

**This is green field: the layout above is created from scratch, and nothing is migrated into it.** A fresh database gets `control`, `data_test`, `data_prod` and a `reporting_<env>` view set per environment from the migrations alone, with the control-plane tables in `control` and the seven data-plane tables, with all twelve of their guards, in each environment schema. No table is moved, no data is carried over, no release row is backfilled, and no existing link is defaulted to an environment, because there is nothing existing. The drizzle chain in `packages/db/migrations` stays append-only, as ADR-18's discipline requires: a new migration creates the schemas and the tables in their final homes, and the chain is not reset to a fresh baseline.

**Note - every guard that multiplies, derived rather than remembered.** The criterion is mechanical: any trigger, CHECK, UNIQUE constraint or index declared on one of the seven data-plane tables exists once **per environment schema**. Read off `packages/db/migrations/*.sql` by table, that is: two triggers, both on `answers` (`answers_reject_update`, 0001; `answers_reject_delete`, 0004); three CHECKs (`answers_retraction_value`, 0009; `webhook_deliveries_snippet_requires_attempt`, 0015; `outbox_redacted_payload_has_no_answers`, 0016); one UNIQUE (`webhook_deliveries_event_webhook_uq`, 0007); and six indexes (`sessions_status_expires_at_idx`, `answers_session_question_answered_at_idx` and `outbox_delivery_idx`, all 0000; `webhook_deliveries_due_idx`, 0007; `outbox_payload_retention_idx` and `webhook_deliveries_snippet_retention_idx`, both 0018). Primary keys ride the `CREATE TABLE`. `form_versions_reject_update` and `question_versions_freeze_published` (both 0001) stay single, because their tables are control-plane and live in `control`. The two trigger **functions** also stay single: a trigger in `data_test` can execute `public.answers_reject_update()`, so N triggers share one function body.

The list is written out because it is what the **generator** has to emit for every environment, including one an operator creates a year from now, and because an environment missing `answers_reject_delete` has an erasable ledger while an environment missing `webhook_deliveries_event_webhook_uq` fans a webhook out twice. Both are silent. Task 064 emits the set from one schema module so that the list is a consequence of the code rather than a paragraph somebody keeps current; this is the list that emission is checked against.

**Note - SEC-10's role split grows a role per environment, and the recipe stops naming `public`.** No application role holds DDL of any kind, so none can create an environment schema; that is the operator command's job under the migration role. `ALTER DEFAULT PRIVILEGES` is keyed on (role, schema, object type) with no per-table filter, so `control` and each `data_<env>` need their own grants and their own ownership by `qcms_migrate`, and the grants are now per role as well as per schema: `qcms_app_test` reaches `control` and `data_test`, `qcms_app_prod` reaches `control` and `data_prod`. That is the symmetry the named schemas buy: every grant in the recipe reads "this role, that named schema", with no schema that gets its rights by being the default one and no role that reaches an environment it does not serve.

Three documents name `public` today and move with this decision, all in task 064: the "Least-privilege database roles" recipe in `docs/operations.md`, whose row says `qcms_migrate` "owns `public` and every object in it" and whose grants are written `IN SCHEMA public`, and which gains the per-environment roles; the SEC-10 paragraph in `docs/SECURITY_DESIGN.md` section 7, which says `qcms_app` gets "no `CREATE` on `public`" and which gains the plural; and the sentence in `docs/reporting-view.md` that `qcms_reporting` "deliberately gets **no** privileges on the `public` schema", which becomes `control` and the data schemas, since those are where the raw ledger, tokens and auth tables then live. All three are correct as they stand and are corrected in the change that moves the tables, not before. `apps/api/e2e/security/03-db-least-privilege.e2e.ts` is where the result is asserted rather than read, and it gains the cross-environment refusal.

`public` itself is left empty and off every search path, with `CREATE` on it granted to nobody. That is the PostgreSQL 15 default rather than a hardening step: the schema documentation says that "in PostgreSQL 15 and later, the default configuration supports this usage pattern", and that on an older or upgraded database you "need to remove the public `CREATE` privilege from the `public` schema (issue `REVOKE CREATE ON SCHEMA public FROM PUBLIC`)". QCMS runs Postgres 16 in every shipped compose file, so the default holds; the recipe states the revoke anyway, because a database an adopter provisioned themselves may have been upgraded from before 15.

The role-per-environment answer (Q17, 2026-09-26) is what makes that listing readable: an operator checking `qcms_app_test` sees `control` and `data_test` and nothing else, so the boundary this design claims is one they can verify with a query rather than infer from a search path.

**Note - the reporting views are per environment, in a schema per environment (Code Owner, 2026-09-26).** `reporting.responses` and `reporting.answers_flat` (migration 0003) read data-plane tables, so a single copy cannot serve more than one environment. The layout is **one schema per environment**, `reporting_prod` and `reporting_test`, each holding the same two view names, so a BI tool connects to one environment's schema and its queries are unchanged apart from the schema it is pointed at. The single `reporting` schema is replaced rather than kept beside them, which green field (Q22) makes free.

The `qcms_reporting` recipe in `docs/reporting-view.md` becomes per environment with them, and the grant an operator writes then reads the same way as every other grant in this design: per named schema. The dev-tools viewer role `qcms_ro` is unaffected, because it holds `pg_read_all_data` rather than per-schema grants; it is a different role in a different document, and the two are easy to confuse.

**Note - `webhooks` is per environment, and the cost is named (Code Owner, 2026-09-25).** The rulings' enumeration of the data plane did not list this table, and the reading it left open is now decided: `webhooks` is per environment, because "a test submission can never fire a production endpoint" is a Postgres guarantee only if the deliverer running under `data_test` cannot see a `prod` endpoint row at all, and the per-environment egress rules of SEC-14 then restate the same rule where a firewall can enforce it. Two costs come with it and are accepted: endpoint configuration is **authored once per environment** and a promotion does not carry it, so a version released to `prod` fires whatever `prod` has configured; and `webhooks.form_id` becomes the third cross-schema foreign key in the table above.

**Note - one process, one pool per environment (Code Owner, 2026-09-26).** One deployment serves every environment from **one API process holding one connection pool per environment**, and the request's environment selects the pool: from the `/<env>/` route group on the respondent side, from the administrator's switcher on the authoring side. **ADR-20's four containers are unchanged**, which is the reason for choosing this over a process per environment. The outbox deliverer and the retention sweep still start once per process under `config.mount.internal` and **iterate the live environment set**, so `docs/deploy-enterprise.md`'s scheduler-singleton rule holds unchanged rather than multiplying per environment. Per-environment integration tests pin that no path uses the wrong pool, which is the assertion that makes this shape safe rather than merely tidy. The `/<env>/` prefix remains a mountable group in ADR-09's sense, so an operator can leave a non-prod environment unmounted and get a 404 rather than a refusal (that record's own Note records the second mount this needs, since anonymous entry is not separately mountable today). Recorded as the leaning and marked awaiting confirmation in `plan/environments-and-workspaces.md` (Q2); task 064 may follow it provisionally, and everything else this decision states holds under either shape.

**Note - the migration clause is withdrawn (Code Owner, 2026-09-26, Q22).** Ruling 2 of 2026-09-25 ended "an existing installation migrates to one `prod` environment with its current data", and that sentence is withdrawn: this is **green field**. There is no existing installation, so there is no data move, no `ALTER TABLE ... SET SCHEMA` of live tables, no backfill of a release row per already-published form, no defaulting of existing secure links to an environment, and no deployment-ordering concern about doing the schema move and the search-path switch together. It is recorded here rather than deleted because the withdrawn clause is what the `public`-to-`control` move would otherwise have had to carry, and a reader who finds the earlier ruling text needs to know which half of it stands. Everything else in ruling 2 stands unchanged.

**Note.** Section 6 of `plan/environments-and-workspaces.md` records every question this decision raised together with its answer and where that answer landed, cited by number from here and from the task rows in `docs/features/README.md`. Section 7 of that document, open questions, is empty: the decision queue for #995 closed on 2026-09-26.

## Identity and security

### ADR-06 - Separate admin and respondent identity

**Status:** implemented.

**Decision.** Admin authentication uses better-auth with email, password, TOTP, recovery codes, and no self-registration. Respondents use anonymous sessions or secure links at launch. Secure-link token functions stay pure; key storage stays in the shell.

**Note.** The instance is hosted in the API since ADR-35's 2026-07-31 amendment. The shipped instance also enforces a breach-corpus password check (#178) and a sign-in throttle (#374, #390); `docs/SECURITY_DESIGN.md` is authoritative for those controls.

### ADR-41 - Workspaces are an authorisation grouping

**Status:** decided; not built (task 068). Code Owner rulings of 2026-09-25 and 2026-09-26, issue #995. Nothing here is open.

**Decision.** A **workspace** is a named grouping that owns forms and questions and carries the membership that authorises work on them. It is an authorisation boundary between groups sharing one installation, and it is not tenancy (ADR-04).

**The table.** `workspaces` is control-plane state, in the `control` schema ADR-40 names: a workspace id, a display name, a slug, whether it is the installation's shared workspace, and whether release to `prod` requires an approver other than the author. One row per group.

**Ownership.** Every form and every question belongs to exactly one workspace; `forms` and `questions` each gain a non-null workspace reference. Ownership follows the identity row, so it is a property of a `formId` or a `questionId` and not of a version, and a published version never changes hands because the identity above it moved.

**The shared workspace is optional and holds org-wide questions.** At most one workspace per installation is marked shared. A form may pin a published question version owned by its **own** workspace or by the shared workspace, and by nowhere else; publish rejects any other pin. This is what lets an organisation keep one canonical "date of birth" question without making every workspace visible to every other.

**Membership and the four roles.** `workspace_members` holds one row per (workspace, administrator) with exactly one role: **owner** (membership and workspace settings, plus everything below), **editor** (author drafts, publish versions), **approver** (approve and release), **viewer** (read forms, versions and responses). An administrator with no membership in a workspace has no access to its forms, questions or responses. This is where RBAC (issue #179) lands, and enforcement is in the API layer, per route group and per route, never in a BFF (R2) and never only in the UI (SEC-3).

**Slugs stay unique per installation.** `forms.slug` and `questions.slug` are unique across the whole installation, not per workspace, so `/f/{slug}` needs no workspace segment, a slug never changes meaning by context, and no address has to be re-pointed when a form's ownership changes.

**Release to prod may require an approver who is not the author, and does not by default.** When the requirement is on, the approver must be a member of the form's workspace holding `approver` or `owner`, and must not be the administrator who published the version being released; the approval is recorded on the ADR-40 release record, which is what makes it auditable rather than procedural. The switch is per workspace and lives on the workspace row, and it is **off by default**, including on the workspace a fresh database is seeded with. That default is deliberate rather than lax: an installation with one administrator cannot satisfy the rule at all, so defaulting it on would mean a bootstrapped deployment could not release to `prod` until a second account existed, and the first thing an operator would learn about the feature is how to turn it off.

**What a workspace is not.** Not a tenant: one operator, one configuration, one identity store, one database, one deployment. Not an isolation guarantee: the boundary is an authorisation check in the API, not a schema, and the only schema boundary in this system is ADR-40's environment, which a workspace sits entirely inside `control` beside rather than cutting across. Not a routing segment: no URL carries a workspace. Not a configuration scope: deployment flags (ADR-24), themes (ADR-30) and the port allocation (ADR-37) remain installation-wide. An administrator with the installation-wide credential and database access reaches everything, exactly as before.

**Note.** `questions.slug` already carries a unique constraint (`questions_slug_unique`, migration 0000). `forms.slug` does not: `packages/db/src/queries/forms.ts` resolves the public address with `limit(1)` and says so in its own comment, calling uniqueness "an authoring-time concern, not a DB constraint yet". The slug rule above is therefore a constraint task 068 adds, not one it inherits. Green field (Q22) makes adding it cheap rather than risky: there is no installation holding a duplicate for the constraint to fail against, so it goes in with the table rather than behind a data check.

**Note - how the installation-wide claim composes with membership (Code Owner, 2026-09-25).** The SEC-3 `user.role` claim is otherwise unchanged: it is installation-wide, carries `admin` today, and is declared to better-auth with `input: false` so no request body can set it. Composition is decided as **sees all, edits none without membership**:

- The claim grants **operations and visibility across every workspace**: installation settings, user and membership administration, response reads and exports. An operator can see the whole installation, which is what makes an operator useful during an incident and what keeps the first bootstrapped account from being locked out of the product it just created.
- **Authoring needs a role in the workspace.** Creating or editing a draft, publishing a version and releasing one require `editor`, `approver` or `owner` membership in that form's workspace. The claim alone is not authoring authority anywhere.
- **Approver-not-author applies to that account too.** Holding the installation-wide claim does not make an administrator eligible to approve their own release; the rule is about the pair of people, not about privilege level.

So a workspace is an authoring boundary and not a confidentiality boundary against the operator, which is the honest statement of what a single-tenant installation with one identity store can promise, and it is consistent with ADR-04's Note: authorisation between workspaces rather than isolation guarantees. Task 069 enforces it in the API layer and extends the section 3.2 matrix with the four roles and this account shape.

**Note - a question may move workspaces, and existing pins are grandfathered (Code Owner, 2026-09-26).** Ownership is on the identity row, so moving a question is one `UPDATE` and touches no version. Forms in other workspaces that already pin one of its versions **keep serving and keep that pin in their next draft**, which is what ADR-02 and R6 require: a published version is immutable content and a `questionId` never changes meaning. What is refused is a **new** pin from another workspace onto a question that is not in the shared workspace, and it is refused the same way a pin to a `deprecated` version is refused today, so the mechanism is one authors have already met rather than a second kind of publish failure.

**Note - a workspace is archived, never deleted (Code Owner, 2026-09-26).** Archiving requires that the workspace holds no open form and no released version, and its forms and questions are reassigned to another workspace first, so archiving is the last step rather than a cascade. **No response row is ever reached**, which is the property that matters: ADR-17 makes erasure and the retention purge the only two whole-session delete paths, and "delete a workspace" is deliberately not allowed to become a third door.

**Note.** Nothing in this decision changes the respondent side. Respondent authorization stays structural: a session token authorizes exactly one session and there is no respondent-facing enumeration of anything (SEC-3). A respondent never learns a workspace exists.

## Deployment and operations

### ADR-20 - Four-container solo topology

**Status:** implemented.

**Decision.** The default deployment runs portal, admin, API, and Postgres. The API publishes no host port. TLS, HSTS, and routing belong to operator-provided ingress; an optional proxy recipe is not a standing product container.

**Note.** The compose file also defines a fifth, run-to-completion `migrate` job; "four standing containers" holds.

### ADR-34 - OpenTelemetry baseline

**Status:** implemented.

**Decision.** API, admin, and portal use official OpenTelemetry instrumentation at composition roots for W3C trace propagation, OTLP traces, and allowlisted trace-correlated application logs. With no OTLP endpoint, telemetry is a hard no-op. Browser telemetry, custom metrics, and identifier hashing are Phase 4. No collector ships in the base topology.

**Note.** The Next apps use `@vercel/otel` and the API uses `@hono/otel` - the documented compositions for those frameworks, not OpenTelemetry-org packages. SEC-13 span redaction is part of the baseline in all three roots, alongside the log allowlist.

### ADR-37 - Port allocation

**Status:** implemented; amended 2026-08-07 (issue #417).

**Decision.** `QCMS_PORT_SEAT` selects one port-allocation index. Stable services use `7Sxx`; ephemeral harnesses use `17Sxx`. The exact table and runbook live only in `docs/PORTS.md`, and `pnpm check:ports` enforces the allocation. The development-tools overlay may use the stable dashboard and database-viewer slots defined there.

**Note.** Two stale partial restatements of the table exist in `scripts/ports.mjs` header comments and the `scripts/check-ports.mjs` failure message (both omit the overlay slots); the enforcement itself derives from the table and is correct.

## Both frontends

### ADR-08 - Separate frontends, shared renderer

**Status:** implemented.

**Decision.** Admin and portal are separate Next.js applications with different product needs. Both use strict BFF handlers and the same QCMS renderer for form content, so admin previews match the respondent portal.

**Note.** The shared surface is a triple - compiler, `documentForVisible` projection, and renderer - all taken from `@roonga/qcms-ui` by both apps.

### ADR-22 - One UI component stack

**Status:** implemented.

**Decision.** Both frontends use `a2-react-aria`: `@a2ra/core` is exact-pinned and components are vendored into `@roonga/qcms-ui`. No competing component library is allowed. Upgrades are reviewed events and must preserve golden-document conformance.

**Note.** The competing-library lint fence covers `packages/ui/src` **and both apps**: one list of restricted import patterns in `eslint.config.js`, applied to `packages/ui/src/**` (vendored sources and its own tests exempt) and to every `.ts`/`.tsx` file under `apps/portal/` and `apps/admin/`, specs included. **It was scoped to `packages/ui` alone until 2026-09-01 (issue #728, PR #771)**, so the clause that stood here saying the apps hold the rule by consuming `@roonga/qcms-ui/kit` is corrected rather than left standing: consuming the kit was a convention, and nothing stopped a screen taking a widget library as a direct dependency and importing it, which is exactly what this decision says is not allowed. The lint block is the fast fence; `@roonga/qcms-ui`'s exhaustive permitted-import allow-list stays in that package's own import-surface test. **Vendor-tree fidelity became an automated gate on 2026-09-03 (issue #189)**, so the clause that stood here calling it a reviewed artifact and not a gate is corrected rather than left standing: `pnpm check:a2ra-fidelity` compares every file under `src/components/a2ui/` against `packages/ui/a2ra-manifest.json`, a record of upstream's content at the pinned commit, on every `pnpm verify` and in CI, offline. `packages/ui/a2ra-diff.md` remains the reviewed artifact beside it, refreshed at each pin move; the gate is what holds on the days in between. The decision is unchanged - this note records how it is enforced.

### ADR-26 - Different frontend decisions by surface

**Status:** implemented; the admin bullet amended 2026-08-31 (issue #725).

**Decision.**

- **Admin:** internal, desktop-primary, QCMS-branded, and client-heavy where editing demands it. Server components read and Server Actions mutate through the BFF, with scoped client editor state. No client-side server-state library.
- **Portal:** public, mobile-first, adopter-themed, SSR-first, and fetch-only with minimal client state.
- **Shared:** the a2ra component stack, WCAG 2.2 AA, semantic tokens, and the renderer used for form content and previews.

**Note.** The admin bullet named TanStack Query until the Code Owner amended it on 2026-08-31 (issue #725). The library was never adopted; server components plus Server Actions are the shipped mechanism, and the bullet now names it and rules a client-side server-state library out rather than permitting one.

**Note.** The admin runs Tailwind's default type scale rather than the portal's `--type-*` floors (issue #442, Code Owner decision 2026-09-02). The mechanism: the `@theme` block in `packages/ui/src/theme-components.css` that raises `--text-sm` and `--text-xs` to those floors is global to a build and no selector can scope it, and that sheet must be imported so the task-058 preview island shows genuine portal treatment, so `apps/admin/app/globals.css` re-pins the five affected variables to Tailwind's defaults. The portal's floors are unaffected. This is surface-specific in the sense the admin bullet already carries, and `docs/admin-constraints.md` already holds WCAG 2.2 AA as a goal the admin builds toward rather than a blocking gate; raising the admin to the floors would reflow 139 call sites across a shipped internal tool. The comment in `apps/admin/app/globals.css` is the local explanation and points here; this Note is the record.

### ADR-27 - Internationalization in both apps

**Status:** implemented.

**Decision.** User-facing chrome comes from app catalogs; authored content comes from `LocalizedText`. Dates, numbers, and currency use `Intl`. Additional translations and a runtime locale switcher are Phase 4, but the localization machinery is launch scope.

**Note.** Both apps now carry a locale constant and a format module: `apps/admin/lib/i18n/format.ts` exports `ADMIN_LOCALE` and `apps/portal/lib/i18n/format.ts` exports `PORTAL_LOCALE`, and both are `en` (issue #729). The portal used to inline `toLocaleString("en-US", ...)` in `components/completion-view.tsx` and to let its A2UI step views inherit the renderer package's own `en-US` default for react-aria, so a second portal locale meant editing components; both resolve `PORTAL_LOCALE` now. The respondent-facing strings are unchanged: for every value the portal renders, `en` and `en-US` resolve to the same CLDR data, which `apps/portal/lib/i18n/format.test.ts` asserts. No currency value exists in the domain yet; that clause is forward-looking. A runtime locale switcher stays Phase 4 (issue #732).

**Note (issue #906).** The admin's three A2UI preview surfaces were the last call sites on the renderer package's own `en-US` default, one surface behind the portal half above.
`apps/admin/lib/i18n/format.ts` now exports `PREVIEW_LOCALE` and `components/forms/draft-preview.tsx`, `components/forms/version-view.tsx` and `components/questions/question-preview.tsx` all pass it, so the locale react-aria formats and announces the previewed controls on is declared once rather than inherited three times.
**It mirrors `PORTAL_LOCALE` rather than reading the form's own `defaultLocale`, and that is the decision this note exists to record.**
`defaultLocale` selects WHICH localized strings the compiler writes into the stored document (ADR-11, invariant I3); by the time a step reaches the renderer that choice is baked into bytes, and what is left for the `locale` prop is how the controls around that text are formatted and announced.
The portal resolves that from its own app constant and reads `defaultLocale` nowhere, so a preview keyed to the form's tag would render a form whose `defaultLocale` is, say, `en-AU` differently from the portal serving that same form: preview fidelity (ARCHITECTURE section 6) lost from the other side.
Nothing on screen moved, and that is measured rather than asserted: `packages/ui/src/locale.test.tsx` renders every step of the golden corpus under `en` and under `en-US` and the markup is identical, and renders it under a locale that genuinely differs so the prop is shown to be load-bearing.
`PREVIEW_LOCALE` carries the react-aria tag and only that, which is today's whole job because a stored document's text is already resolved.
When issue #732 gives a respondent a locale of their own, this declaration is where the preview's copy of that tag moves, and the compiled document's own locale is a second half that #732 owns rather than anything this constant can express; the operator's chrome stays on `ADMIN_LOCALE`.

### ADR-38 - Theme scope carrier

**Status:** implemented.

**Decision.** Theme and font token sheets target `:is(:root, [data-qcms-theme-scope])`. Component treatments target descendants of the bare carrier attribute. This lets admin previews render portal tokens and treatments without restyling admin chrome, while preserving existing root-based adopter overrides.

**Note.** Two known containment limits: the Tailwind `@theme` block raising the WCAG 1.4.12 floors is global by construction, and the admin neutralizes it manually; portalled overlays (select, calendar, menu popovers) attach to `document.body` outside the carrier, so previews show admin tokens for transient overlays.

## Process and delivery

### ADR-05 - Owned shell, versioned invariants

**Status:** partly built.

**Decision.** Adopters own scaffolded routes, pages, adapters, and themes. Domain rules, the compiler, migrations, and other audit-sensitive machinery ship as versioned packages.

**Note.** The public/private package split and the changeset gate are in place, but `create-qcms-app` (task 037) and a package publish workflow do not exist yet; nothing has ever been published.

### ADR-23 - Test layers

**Status:** implemented.

**Decision.** Vitest covers unit, component, database, and API scenario tests. Playwright is the only browser framework. Every feature adds coverage at the highest available layer; browser-facing work requires a passing browser flow.

### ADR-29 - One root conductor

**Status:** process.

**Decision.** The Dev Container is the canonical development environment. One root conductor owns the task end to end and delegates bounded implementation and exact-head review to subagents. All agents share repository state as their working context.

**Note.** Practice has refined this: parallel executors are supported, with review and merge serialized through the conductor. The Dev Container is canonical but the host toolchain remains supported.
