# QCMS - Architecture

**Status:** authoritative
**License:** MIT · **Runtime:** Node LTS · **Language:** TypeScript end to end

---

## 1. System overview

QCMS is an open-source engine for questionnaires, surveys, and registration flows with deeply conditional logic - answers to earlier questions determine which questions follow. It is distributed in the shadcn ethos: adopters scaffold the application into their own repository and own the source, while the invariant machinery (domain model, rules engine, compiler, migrations) ships as versioned packages they upgrade like any dependency.

The system serves three audiences. **Form authors** curate questions and workflows, publish, and version them through an admin portal. **Respondents** complete flows through an SSR end-user portal, accessing forms anonymously or via signed secure links (OTP and social auth arrive post-launch). **Downstream systems** receive submissions via a signed webhook, CSV/JSON export, or a documented read-only reporting view in Postgres; a versioned pull API (`/api/v1`) is a reserved seam, not a launch surface.

Three properties are non-negotiable: published form versions are **immutable**; the serving path is **deterministic** (no LLM at runtime); every stored answer is **auditable** against the exact form version and rendered UI it was given.

## 2. Architectural principles

One repeated move: take the boring default now, engineer the structural seam so the ambitious option remains a feature away rather than a migration away. Concretely: question-level versioning in the schema with minimal launch UX; a localizable text schema with a single-locale product; single-tenant deployments with multi-tenancy as a recipe; a compiled-UI pipeline with a reserved agent extension point; a fetch-pure API that keeps a Bun migration one Dockerfile away.

The second principle is the **ownership seam**: code a customizer would reasonably change (routes, pages, UI, adapters, theming) is scaffolded owned source; code whose modification would break audit or versioning guarantees (domain model, rules evaluation, publish compiler, migration history) is a versioned package.

## 3. Source-of-truth model

Three schemas, a single direction of derivation. No layer reaches upward.

```
FormDefinition ──────compile──────▶ A2UI documents ──────persist──────▶ Postgres
   (meaning)                            (views)                        (storage)
@roonga/qcms-core            @roonga/qcms-a2ui-compiler            @roonga/qcms-db
```

**FormDefinition** (domain) governs meaning: stable `questionId`s, semantic types, constraints, locale-mapped text, pinned question versions, the branching rules DSL. Rule evaluation, answer validation, publish invariants, and reporting operate exclusively on this model.

**A2UI documents** are a pure projection of the domain model, produced at publish time by the compiler - one document per step, rendered client-side by the shared renderer built on `a2-react-aria`. Compiled output is stored inside the published snapshot for audit and zero-work serving. Validation hints in the A2UI payload are UX courtesy; server-side domain validation is the authority.

**Serving policy (ADR-18).** The portal serves the stored audit copy - never a recompilation. Every `FormVersion` stamps `compilerVersion` and `a2uiSpecVersion`. The renderer maintains backward compatibility with every spec version ever published; the golden-document conformance corpus is append-only (documents are added, never deleted) and is the enforcement mechanism.

**Postgres** governs storage only. Published forms are JSONB snapshots the database stores and indexes but does not interpret. Domain evolution (new question types, new rule operators) happens as versioned changes to the core schema under the immutability rule, never as `ALTER TABLE` on meaning.

## 4. Component architecture

```
packages/
  core/            # domain: FormDefinition schema (Zod), rules DSL + evaluator,
                   # answer validation, publish invariants, secure-link token
                   # mint/verify (pure given key material), erasure semantics.
                   # Pure - zero I/O, zero A2UI imports, never imports db.
  a2ui-compiler/   # FormDefinition → A2UI documents. Question-type → component
                   # mapping. The agent seam (ADR-01/14).
  db/              # Drizzle schema, migrations, query helpers, reporting view,
                   # transactional outbox, erasure implementation, retention sweep.
  ui/              # A2Renderer (@a2ra/core, exact-pinned) + vendored a2ra
                   # components via @a2ra/cli (ADR-22). The only renderer.
apps/
  api/             # Hono. Vertical slices; composition root applies mount flags;
                   # hosts the in-process outbox deliverer and sweep scheduler.
  portal/          # Next.js. SSR pages + route handlers as a strict BFF.
  admin/           # Next.js. Client-heavy authoring UI + BFF; separate app
                   # so it deploys independently on the VPN.
```

### 4.1 The domain kernel (`@roonga/qcms-core`)

A functional core: pure functions over immutable data. Public surface, roughly:

| Function                                                                          | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compileDraft(draft): PublishResult`                                              | The single true aggregate. Validates atomically: every rule resolves against pinned question versions; no dangling question/option/step refs; default locale complete and no whitespace-only authored text; **rule dependency graph is acyclic and forward-only (ADR-16)**. Returns a typed error list - all errors, not the first - or, on success, an immutable deep-frozen snapshot plus the non-blocking publish warnings the same pass raised (issue #123).                                     |
| `evaluateRules(snapshot, answers, resolveQuestion): Result<FlowState, EvalError>` | **Single forward pass in document order (ADR-16).** Deterministic, total on valid input; semantics versioned with the snapshot. Conditions over unanswered questions are `false` except `answered`; hidden questions' answers are excluded from evaluation - safe because forward-only ordering makes evaluation single-pass. `resolveQuestion` injects the pinned question definitions (required flags) - same I/O-free lookup pattern as the publish-time type check (task 006, DOMAIN_SCHEMA §3). |
| `validateAnswer(question, value): Result`                                         | Per-type validity; canonical `AnswerValue` encodings are defined with the Stage 1 schema (dates are timezone-less ISO `YYYY-MM-DD`; numbers are IEEE doubles with an `integer` constraint; choice values are `optionId`s).                                                                                                                                                                                                                                                                           |
| `mintSecureLink / verifySecureLink`                                               | Signed, expiring, single-form tokens. Pure given key material - key storage and rotation live in the shell/API.                                                                                                                                                                                                                                                                                                                                                                                      |
| Erasure semantics (ADR-17)                                                        | Core defines what erasure means (which records, tombstone shape, invariants preserved); `@roonga/qcms-db` implements it.                                                                                                                                                                                                                                                                                                                                                                             |

Everything outside the invariant zones is deliberately _not_ domain-modeled: admin CRUD, listing, export, configuration are transaction scripts in their API slices. Decision rule (R5): an invariant spanning more than one field or row belongs in a core function; anything else talks to the database directly.

### 4.2 The rules DSL

A closed, typed JSON rule language: `equals`, `notEquals`, `in`, `gt/gte/lt/lte`, `answered`, `contains`/`containsAny` (multiChoice membership, ADR-21), combined with `and/or/not`, referencing `questionId`s. The closed set is what makes publish-time validation against the versioned question graph possible, keeps evaluation auditable, and lets a visual builder emit the format later. Nesting depth is capped at 8, publish-validated. New operators are versioned core changes.

**Evaluation semantics (ADR-16, frozen with each snapshot):**

1. Targets listed in any rule are _conditional_: hidden by default, shown when a rule matches. Untargeted items are unconditionally visible.
2. A rule's targets must appear strictly later in document order than every question its condition references. Publish rejects violations (typed `RULE_BACKWARD_TARGET`, `RULE_CYCLE` errors).
3. Evaluation is one pass over the document in order; when a question is evaluated as hidden, its answers are excluded from all subsequent condition evaluation and from the locked submission.
4. Same `(snapshot, answers)` → same `FlowState`, forever. Semantic changes require a new semantics version stamped into future snapshots; old snapshots evaluate under their recorded semantics.

### 4.3 Data architecture

Operational tables (owned by `@roonga/qcms-db`):

| Table                            | Purpose                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `questions`, `question_versions` | Question library; versions immutable once referenced by a published form                                                                            |
| `forms`, `form_drafts`           | Form identity and mutable working state (at most one open draft per form)                                                                           |
| `form_versions`                  | Immutable published snapshots: domain JSONB + compiled A2UI JSONB + `compilerVersion` + `a2uiSpecVersion` + semantics version                       |
| `sessions`                       | Respondent sessions; pinned to a form version via the composite FK `(form_id, form_version)`, access mode, expiry                                   |
| `secure_links`                   | Server-side state for secure-link tokens (010/013): revocation, atomic one-time consumption - a signature alone is never sufficient (SEC-2)         |
| `answers`                        | **Append-only** ledger `(session_id, question_id, value, answered_at)`; current = latest row; submission locks the set. No UPDATE path exists.      |
| `submissions`                    | Lock records: session, locked answer-set hash, submitted timestamp                                                                                  |
| `erasure_tombstones`             | ADR-17: `(session_id, form_id, form_version, erased_at, reason)` - existence without content                                                        |
| `outbox`                         | Transactionally written domain events (`response.submitted`, `form.published`) with delivery state, attempt count, next-retry, and dead-letter flag |
| better-auth tables               | Users, sessions, accounts for admin (2FA enabled) + later respondent identity                                                                       |

**Reporting.** Read-only `reporting.responses` (and friends) is the documented SQL contract for BI/ETL - the pull path shipping at launch in place of the deferred API. Erased sessions are excluded by construction.

**Retention and erasure.** Session expiry lives in the schema from day one; a sweep job expires abandoned sessions. Erasure (ADR-17) hard-deletes a session's ledger and submission and writes a tombstone. Together these are the GDPR story: retention limits by default, erasure on request.

## 5. API architecture

### 5.1 Surfaces and exposure

One Hono codebase defines all routes as composable groups; a deployment flag controls which groups a process mounts. Admin routes do not exist in a public-facing process - network isolation is a build-time guarantee.

| Surface                   | Consumer                | Auth                                        | Exposure         | Stability                                        |
| ------------------------- | ----------------------- | ------------------------------------------- | ---------------- | ------------------------------------------------ |
| Portal-internal endpoints | Portal BFF only         | Session token binding                       | Internal network | None - internal contract                         |
| `/admin`                  | Admin app BFF           | better-auth session (2FA)                   | VPN / internal   | None - internal contract                         |
| `/api/auth/*`             | Admin app BFF           | Internal token only (it issues the session) | VPN / internal   | Vendor's (better-auth), endpoint set allowlisted |
| `/health`, `/ready`       | Orchestrators, monitors | None (liveness) / internal                  | Both processes   | Stable by convention                             |
| `/api/v1` _(reserved)_    | Third parties           | Scoped tokens                               | Internet         | Versioned + generated OpenAPI                    |

No launch surface carries a stability contract - every API can change freely while the product finds its shape. All routes are nevertheless defined with `@hono/zod-openapi` from the first slice (017's convention), and CI generates and drift-asserts valid OpenAPI documents for the respondent and admin surfaces (027) - labeled `x-stability: internal`: descriptive documentation of the current build, never a compatibility promise. When `/api/v1` returns, the same machinery publishes its versioned schema with the stability promise and PAT security scheme turned on, so the published schema cannot drift.

### 5.2 Vertical slices

Each feature is a folder owning its route definition (`@hono/zod-openapi` `createRoute` - 017's convention), request/response Zod schemas, handler, and tests, exporting a Hono sub-router composed at the root:

```
apps/api/src/features/
  forms/      create-draft/ · publish/ · list/ · versions/ · …
  questions/  create/ · new-version/ · publish/ · list/ · deprecate/ · …
  responses/  start-session/ · get-step/ · submit-answer/ · submit/ ·
              list/ · export/ · erase/ · …
  links/      mint-secure-link/ · …
  webhooks/   configure/ · deliver/ (worker, not a route) · redeliver/ · …
  auth/       better-auth instance · allowlisted /api/auth mount ·
              first-run bootstrap · recovery-code read      (056)
app.ts        # composes slices, applies mount flags, mounts middleware
```

Cross-cutting concerns - auth, error envelope, logging, rate limiting - are ordinary middleware at the composition root; no mediator, no pipeline framework, no repository-interface layer. Handlers are plain async functions with explicit dependencies, kept **fetch-pure** (R4). Slices load state, call the kernel where an invariant is involved, persist the result, and write outbox events in the same transaction where an integration must observe the change.

### 5.3 Background work (in-process, not a fifth container)

The API process hosts two schedulers, started by the composition root (not by handlers, so fetch-purity is untouched):

- **Outbox deliverer.** Polls undelivered `outbox` rows; delivers webhooks with HMAC request signing; exponential backoff with capped retries; after exhaustion, rows are flagged **dead-letter** - visible in the admin UI with a manual redeliver action. At-least-once, never best-effort. Uses `FOR UPDATE SKIP LOCKED` so multiple API instances don't double-deliver.
- **Retention sweep.** Periodically expires abandoned sessions per the retention policy.

In the enterprise topology these run in the internal API instance only (a mount-flag concern, like routes). This keeps the solo budget at four containers.

## 6. Frontend architecture

**Portal** (Next.js, public): fully SSR pages for fast first paint, hydrating into the shared A2UI renderer. First paint is a real no-JS fallback form, implemented and covered by the portal no-JS browser suite. React replaces that form on hydration rather than adopting it in place, so an in-progress interaction with a React-controlled input before hydration is discarded; a completed native submission is supported. Route handlers are a strict BFF - session cookies, server-held credentials, proxying; no rule evaluation, no validation authority (R2).

**Admin** (Next.js, VPN in enterprise topology): predominantly client components - form builder, structured condition editor, question library - using the same BFF pattern against `/admin`. Its most important feature is preview fidelity: previews render through the identical `packages/ui` renderer, in the same runtime, so what the author sees is what the respondent gets. The condition editor is structured JSON editing with live kernel validation (ADR-19); a visual builder is Phase 4. Admin screens are **ordinary React** built from the same vendored `a2-react-aria` component set in `packages/ui` (ADR-22) - A2UI documents and `A2Renderer` appear in the admin only inside the preview pane, never for the admin's own UI.

One framework for both frontends: one router, one data-fetching idiom, one auth integration, one Docker build shape, zero cross-origin cookie/CORS handling. Separate deployables because the topology requires it.

## 7. Identity and access

Admin identity: **better-auth**, configured in owned shell code, data in the deployment's own Postgres, **TOTP 2FA enabled at launch** for accounts that can publish forms and read responses. The instance is hosted in **the API** (task 056; ADR-35 as amended 2026-07-31), mounted on `/api/auth/*` behind the SEC-4 internal token and an explicit endpoint allowlist, so the API is the deployment's only database client. The browser never reaches it: the admin app forwards one named operation per auth step (sign-in, the two 2FA verifications, sign-out, password change, session read) over the internal channel and re-emits better-auth's `Set-Cookie` headers on its own redirect, so cookies stay first-party to the admin origin and no CORS surface exists. The allowlist is what keeps SEC-1's "no self-registration path exists in any composition" true over a library whose documented mount is a catch-all: `sign-up/email` is absent, so it 404s, and the only caller of `signUpEmail` is the first-run CLI. Respondent access at launch: **anonymous sessions** and **secure links** - signed, expiring, single-form tokens minted and verified by core functions (key material supplied by the shell; rotation documented). Secure-link generation is an admin feature (mint from the form view, copy/export URLs). OTP and social are Phase 4 via the same library; external IdPs are a documented swap recipe.

## 8. Abuse resistance

In the API (guards the data model): per-session and per-IP rate limits on answer/submit endpoints, honeypot fields, minimum-time-to-complete heuristics, session-token binding. In the shell (vendor-shaped): a **challenge adapter** - null by default, activated by the `QCMS_FLAG_CHALLENGE_PROVIDER` deployment flag (ADR-24), Cloudflare Turnstile implementation included, required per form via a form setting. Invisible challenges are the deliberate default; visible CAPTCHAs are an accessibility liability the heuristics exist to avoid.

## 9. Deployment topologies

```
# Enterprise
internet ──▶ portal (SSR + BFF) ───────────────┐
vpn ───────▶ admin ──▶ /admin ─────────────────┤
                  └─▶ /api/auth (better-auth)  ▼
                                    api-internal ──▶ postgres
                                    (outbox deliverer + sweep run here)
                                               │
        on submit: signed webhook ─────────────▶ downstream systems
        pull path: reporting view ─────────────▶ BI / ETL

# Solo (docker-compose default)
operator ingress (TLS - cloud LB or optional Caddy overlay, ADR-20)
   │ routes portal + admin only
portal · admin · api (all groups + workers; no published port) · postgres
```

Both topologies run the same images; the difference is instance count and mount flags. The solo shape - four containers (portal, admin, api, postgres), one a database, with TLS/ingress supplied by the operator (ADR-20) - is the operability budget and the reference deployment the scaffold produces.

**The API is the only process in either topology that holds a database handle.** Neither frontend has one. `apps/admin` declares no `pg`, `drizzle-orm`, or `@roonga/qcms-db` dependency, receives no `DATABASE_URL`, and has an import-surface test that enforces an empty allowlist of `@roonga/qcms-db` value bindings.

## 10. Operations

Committed at launch (Stage 8b), not aspirational:

- **Health:** `/health` (liveness) and `/ready` (DB connectivity) on API; equivalent checks on both Next apps; compose healthchecks wired.
- **Backup/restore:** documented `pg_dump`/restore procedure in the README, with a tested restore drill as part of the 8b exit criteria. The database is the _only_ stateful component by design.
- **Logs:** structured JSON logs to stdout from all processes (12-factor); the shared server logger redacts fields before output and adds `trace_id`/`span_id` from the active OTel context automatically when tracing is on (see §10.1). The local LGTM stack receives the same allowlisted records over OTLP.
- **Webhook observability:** delivery state, attempt history, and dead-letters visible in admin; manual redelivery.
- **Upgrades:** packages release via Changesets from Stage 5; `pnpm up` + `drizzle-kit migrate` is the adopter upgrade path, exercised in CI from the start.

### 10.1 Observability: tracing and correlated logs (ADR-34, tasks 054 and 062)

QCMS is adopter-hosted, so it ships **instrumentation and conventions, never a backend choice**: OpenTelemetry, W3C Trace Context for propagation, OTLP for export, and no collector in the deployment (the four-container budget of ADR-20 is unchanged - adopters point `OTEL_*` at their own infrastructure). Alerting, SLOs, dashboards and telemetry retention are adopter territory.

**Off unless asked for.** With `OTEL_EXPORTER_OTLP_ENDPOINT` unset, no SDK starts in any process: the gate is explicit in each composition root, because the OTLP exporter's own default is `http://localhost:4318` and "unconfigured" must mean silent, not a connection error per flush. Configuration is standard `OTEL_*` variables only (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER`) - no new `QCMS_` flag.

**The SDK is wired at all three app composition roots:**

| Where                                             | How                                                                                                                                                                                         | Spans it produces                                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api` (`src/serve.ts` -> `src/telemetry.ts`) | canonical `NodeSDK` bootstrap; the entry starts it and only then dynamically imports `main.ts`, because the instrumentations patch `pg` and `node:http` as those modules are first required | `@hono/otel` server span (extracts the inbound `traceparent`), `instrumentation-http`, `instrumentation-undici` (outbound webhook delivery), `instrumentation-pg` (parameterized statement text, no bound values) |
| `apps/portal` (`instrumentation.ts`)              | Next's documented route: `register()` + `registerOTel` from `@vercel/otel`, Node runtime only                                                                                               | Next's own request/render spans plus its `fetch` span for the BFF hop, with `propagateContextUrls` covering the API origin so the fetch carries `traceparent`                                                     |
| `apps/admin` (`instrumentation.ts`)               | the same documented Next composition-root setup and API-origin propagation as the Portal                                                                                                    | Next request/render spans and the Admin-to-API `fetch` span                                                                                                                                                       |

Instrumentation is an **explicit list of official packages**; `auto-instrumentations-node` is deliberately excluded (same code, 100+ packages of dependency surface), and no fetch/undici instrumentation is added to the Next apps (Next already emits that span, so adding one double-instruments the hop). The API's raw incoming `node:http` span is suppressed because `@hono/otel` supplies the semantic server span; this prevents duplicate SERVER spans for one request. `@roonga/qcms-core` stays **OTel-free**: spans wrap the kernel, never enter it, so determinism and the golden corpus are untouched by construction.

**One respondent action is one trace, and `x-request-id` still works.** The trace starts at the portal server (browser-side telemetry is out of the baseline: CSP surface, consent, payload cost - and R2 means the browser only ever talks to the portal). `traceparent` is the machine propagation; `x-request-id` remains the human-facing token in the error envelope and in support conversations, now minted once per browser request by the portal proxy, forwarded by the BFF, honoured by the API, and recorded on the API's server span as `qcms.request_id`. That gives three joins on one id: the response header, the log line, and the span.

**Signals.** All three services produce traces, trace-correlated structured stdout logs, and OTLP logs. No custom metrics are emitted (duration, status and error rate derive from spans). Exported logs are not raw stdout: a processor replaces unknown event bodies and drops every attribute outside a small operational allowlist before the batch exporter can queue it. Redaction is a security control specified as **SEC-13** in `SECURITY_DESIGN.md` §8a: answer values, direct identifiers, free-text errors, `LocalizedText`, `lnk_` tokens and secrets never appear in any exported signal; branded ids are permitted as pseudonymous correlators.

**Verification** is an in-test OTLP receiver, not a viewer: `apps/portal/e2e/otel-trace.pw.ts` drives a real respondent submit through browser -> portal -> API -> Postgres and asserts one connected trace, the `x-request-id` joins, and that a known submitted answer value appears in no exported payload. The optional local trace-viewer recipe is in `DEVELOPER_GUIDE.md`.

## 11. Cross-cutting commitments

**Accessibility.** WCAG 2.2 AA: automated axe checks in CI on both frontends; flow-level criteria component libraries cannot supply - focus management when branching inserts/removes questions, `aria-live` announcements for step changes and errors, full keyboard traversal; manual NVDA + VoiceOver pass per release against the kitchen-sink form, which triples as visual regression fixture and A2UI conformance input.

**Internationalization.** Every human-readable core field is a locale map with a per-form default locale; launch handles one locale. Shell chrome uses a conventional message catalog in owned source, separate from form content.

**Reliability of egress.** `response.submitted` is written to the outbox in the submission transaction and delivered by the background loop with retries, signing, and dead-letter visibility.

**Auditability.** Immutable snapshots (domain + compiled UI + version stamps), version-pinned sessions, append-only ledger, and erasure tombstones together answer "what was asked, what was shown, what was answered, when it changed - and what was erased, when."

## 12. Reserved seams

| Seam                              | Where it lives                              | What it enables later                                              |
| --------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| Step-resolver / compiler swap     | `@roonga/qcms-a2ui-compiler`                | Agent-adaptive _serving_ flows (Phase 4)                           |
| `DraftAssistant` provider adapter | `apps/api` (041, ADR-25)                    | Any LLM vendor behind agent-assisted authoring; local models later |
| `/api/v1` route group             | `apps/api` composition root                 | Versioned pull API with generated OpenAPI                          |
| Challenge adapter                 | Shell                                       | Any CAPTCHA/risk vendor                                            |
| Auth adapter surface              | Shell (better-auth config)                  | OTP, social, external IdPs                                         |
| Locale maps                       | Core schema                                 | Full i18n UX                                                       |
| Question library machinery        | Schema already question-versioned           | Impact analysis, breaking-change detection                         |
| Link target policy                | Start-session slice and secure-link state   | Always latest or exact-version distribution (ADR-39, Phase 4)      |
| Fetch-pure handlers               | `apps/api`                                  | Bun (or edge) runtime by base-image change                         |
| Multi-tenancy                     | Documented recipe                           | Org-scoped SaaS derivative                                         |
| A2UI spec versioning              | Snapshot stamps + append-only golden corpus | Breaking A2UI evolution without snapshot migration                 |

## 13. Repository layout (monorepo, full tree)

The complete structure tasks build into. Created empty in Stage 0 (001); each annotation names the owning task(s).

```
qcms/
├── package.json                  # workspace root · pnpm + turbo scripts        (001)
├── pnpm-workspace.yaml
├── turbo.json                    # build/test/lint/typecheck pipeline           (001)
├── tsconfig.base.json            # strict shared TS config                      (001)
├── .nvmrc · .npmrc · .gitignore · .env.example                                # (001, 017)
├── LICENSE                       # MIT
├── README.md                     # the two-command quickstart · launch-gated    (001, 036, 038)
├── SECURITY.md                   # disclosure policy                            (040)
├── PROJECT_INSTRUCTIONS.md       # agent ground rules - read first              (001)
├── .changeset/                   # versioning for publishable packages          (001)
├── .github/
│   └── workflows/                # ci.yml · e2e.yml · images.yml · release.yml (001, 027, 036)
│
├── docs/
│   ├── PROJECT_GOAL.md · ARCHITECTURE.md · IMPLEMENTATION_PLAN.md
│   ├── DOMAIN_SCHEMA.md · SECURITY_DESIGN.md
│   ├── adr/                      # the decision record, split by surface
│   ├── features/                 # the numbered task files (this plan)
│   ├── a2ui-mapping.md (011) · agent-seam.md (011) · secure-links.md (010, 024)
│   ├── reporting-view.md (015) · erasure.md (016) · a11y.md (030)
│   ├── theming.md (051)          # the four-group token contract (ADR-30)
│   ├── deploy-enterprise.md · backup-restore.md · operations.md (036)
│   ├── ownership-seam.md (037) · auth-swap.md (031)
│   └── api-walkthrough.md (027) · launch-validation.md (038)
│
├── packages/
│   ├── core/                     # @roonga/qcms-core - pure domain kernel (R3: no I/O, no db import)
│   │   ├── src/
│   │   │   ├── ids.ts · localized-text.ts · answer-value.ts       (002)
│   │   │   ├── question.ts                                        (003)
│   │   │   ├── form.ts · publish-errors.ts                        (004)
│   │   │   ├── rules/  schema.ts · graph.ts                       (005)
│   │   │   │           evaluate.ts  # SEMANTICS_VERSION lives here (006)
│   │   │   ├── publish/ compile-draft.ts                          (008)
│   │   │   ├── answers/ validate.ts · submission.ts               (009)
│   │   │   ├── links/   tokens.ts   # mint/verify, WebCrypto only  (010)
│   │   │   └── erasure.ts          # semantics only; db executes   (016)
│   │   ├── fixtures/  questions/ · forms/ (kitchen-sink, insurance…) (003, 004)
│   │   └── golden/    evaluator/  # scenario corpus + CORPUS.md      (007)
│   │
│   ├── a2ui-compiler/            # @roonga/qcms-a2ui-compiler - the agent seam
│   │   ├── src/  compile.ts · mapping.ts · step-resolver.ts        (011)
│   │   └── golden/ v1/           # APPEND-ONLY corpus (ADR-18)      (012)
│   │
│   ├── db/                       # @roonga/qcms-db - Drizzle schema, migrations, helpers
│   │   ├── src/
│   │   │   ├── schema/           # tables incl. outbox, tombstones  (013)
│   │   │   ├── queries/          # helpers incl. latestAnswers      (014)
│   │   │   ├── reporting.ts · retention.ts                         (015)
│   │   │   └── erasure.ts        # the only DELETE door             (016)
│   │   ├── migrations/           # immutable once released          (013+)
│   │   └── test/  harness.ts     # testcontainers withTestDb        (013)
│   │
│   ├── ui/                       # @roonga/qcms-ui - A2Renderer + vendored a2ra components (ADR-22)
│   │   └── src/  A2UIStepRenderer.tsx · components/a2ui/ (vendored via
│   │             @a2ra/cli, a2ra.json committed) · conformance/          (028)
│   │
│   ├── observability/            # @roonga/qcms-observability - shared server logging (published)
│   │   └── src/  logger.ts       # redacting JSON logger + trace correlation (062)
│   │             otlp-log-allowlist.ts  # SEC-13 allowlist for exported logs (062)
│   │             next-span-redaction.ts # SEC-13 span redaction for both Next apps (062)
│   │
│   └── csv/                      # @roonga/qcms-csv - RFC 4180 quoting + the formula-injection
│       └── src/  index.ts        # guard every exported cell passes through (#470)
│
├── apps/
│   ├── api/                      # Hono · vertical slices · fetch-pure (R4)
│   │   ├── src/
│   │   │   ├── app.ts            # composition root + mount flags   (017)
│   │   │   ├── config.ts         # Zod env schema, fail-fast        (017)
│   │   │   ├── middleware/       # envelope · logging · rate-limit · auth (017, 021, 031)
│   │   │   ├── workers/          # outbox deliverer · sweep         (017, 025)
│   │   │   ├── serve.ts          # entry: telemetry, then main       (017, 054)
│   │   │   ├── main.ts           # composes deps, binds port, workers (017)
│   │   │   ├── create-admin.ts   # first-run bootstrap CLI entry      (056)
│   │   │   ├── telemetry.ts      # gated NodeSDK + SEC-13 span and
│   │   │   │                     # log-record redaction          (054, 062)
│   │   │   └── features/
│   │   │       ├── responses/  start-session/ (018) · get-step/ · submit-answer/ (019)
│   │   │       │               submit/ (020) · list/ · export/ · erase/ (023)
│   │   │       ├── questions/  create/ · versions/ · publish/ · deprecate/ (021)
│   │   │       ├── forms/      drafts/ · validate/ · publish/ · versions/ (022)
│   │   │       ├── links/      mint/ · revoke/                     (024)
│   │   │       ├── webhooks/   configure/ · redeliver/             (024, 025)
│   │   │       └── auth/       better-auth instance · /api/auth mount ·
│   │   │                       bootstrap · recovery codes          (056)
│   │   ├── e2e/                  # scenario suite + security matrix (027, 040)
│   │   └── CONTRIBUTING.md       # slice conventions                (017)
│   │
│   ├── portal/                   # Next.js · SSR + strict BFF (R2)
│   │   ├── instrumentation.ts    # gated registerOTel (@vercel/otel) (054)
│   │   └── src/app/  f/[formSlug]/ · l/[token]/ · s/[sessionId]/ · done/
│   │                 api/        # BFF route handlers - proxy only  (029)
│   │
│   └── admin/                    # Next.js · client-heavy + BFF · VPN deployable
│       │                         # no database handle, no better-auth (056)
│       ├── instrumentation.ts    # gated registerOTel (@vercel/otel) (062)
│       └── src/app/  (auth)/ sign-in · 2fa                         (031)
│                     questions/ (032) · forms/[id]/ builder · publish ·
│                     preview · versions · links (033, 034)
│                     responses/ · webhooks/ · erasures/            (035)
│
├── tooling/
│   ├── create-qcms-app/          # scaffolding CLI (publishable)    (037)
│   └── e2e-support/              # browser-suite helpers both apps
│                                 # import (private)            (#187, #236)
│
├── docker/
│   ├── api.Dockerfile · portal.Dockerfile · admin.Dockerfile       (036)
│   └── proxy/                    # optional Caddy overlay config    (036)
├── docker-compose.dev.yml        # dev Postgres                     (001)
├── docker-compose.yml            # solo: portal·admin·api·postgres  (036)
├── docker-compose.proxy.yml      # optional single-VM TLS overlay   (036)
└── docker-compose.dev-tools.yml  # opt-in dev toolbox, never ships  (#417)
```

Layout rules: golden/fixture directories live with the package that owns their meaning; `apps/*` never import each other; `packages/ui` is the only renderer (preview fidelity); anything under `docs/` named in a task's exit criteria is a deliverable, not an afterthought.

---

_Companion documents: `PROJECT_GOAL.md` (vision and scope) · `adr/` (ADR-01…39) · `SECURITY_DESIGN.md` (SEC-1…13) · `IMPLEMENTATION_PLAN.md` (staged delivery) · `DOMAIN_SCHEMA.md` (domain model and rule semantics)._
