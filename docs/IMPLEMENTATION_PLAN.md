# QCMS - Implementation Plan

**Status:** v2.2 (formal) · supersedes Draft v1 · incorporates ADR-16…25 and the 2026-07-18 / 2026-07-19 review resolutions
**Cadence:** single developer with agentic AI leverage, part-time to full-time. Stages are sequential; each lands a meaningful, testable increment. **Exit criteria gate stages, not dates.**

The plan follows the architecture's grain: the kernel is built and proven headless before any HTTP exists; HTTP is proven before any UI; the respondent experience ships before the authoring experience; launch happens at Stage 8, not at feature completeness.

Each stage decomposes into numbered task files in `features/` - each written as standalone agent instructions with context, deliverables, steps, and exit criteria. Execute them in numeric order; a task's header lists its hard dependencies.

---

## Changes from Draft v1 (gap resolutions)

| Gap (reviews 2026-07-18 · 2026-07-19) | Resolution | Lands in |
|---|---|---|
| Fixpoint evaluation semantics ill-defined | ADR-16: forward-pass evaluation; publish-time cycle/backward-target rejection | Stages 2–3 (tasks 005, 006, 008) |
| Canonical `AnswerValue` encoding deferred too late | Decided in Stage 1 with the schema, before the evaluator exists | Stage 1 (task 002) |
| GDPR erasure unaddressed | ADR-17: hard-delete + tombstone; admin-surfaced | Stage 5 (016), Stage 6 (023), Stage 8a (035) |
| A2UI backward-compat burden unstated | ADR-18: serve audit copy; version stamps; append-only golden corpus | Stage 4 (012), Stage 5 (013) |
| Stage 8 dangerously large | ADR-19: split 8a Authoring / 8b Distribution; structured condition editor is the default; CLI off the launch gate | Stages 8a/8b |
| Secure-link minting had no home | Core mint/verify in Stage 3 (010); API mint slice in Stage 6 (024); admin UI in 8a (034) | 3 / 6 / 8a |
| Outbox deliverer had no runtime home | In-process scheduler in the API composition root; dead-letter + manual redelivery | Stage 6 (017, 025), admin in 8a (035) |
| No ops story (health, backups, logs) | Health/ready endpoints (017); structured logs (017); backup/restore doc + tested drill (036) | Stages 6, 8b |
| Admin auth hardening | TOTP 2FA at launch via better-auth | Stage 8a (031) |
| File-upload question type unrecorded | Recorded as `phase-4` issue | Stage 9 (039) |
| Webhook dead-letter invisible | Delivery state + redeliver in admin | Stage 6 (025), 8a (035) |
| Solo topology omitted the admin app; bundled proxy assumed | ADR-20: solo = portal · admin · api · postgres; TLS/ingress operator-supplied; API never published | Stage 8b (036) |
| multiChoice equality undefined; containment inexpressible | ADR-21: set equality; `contains`/`containsAny` operators | Stages 1–2 (002, 005–007) |
| SECURITY_DESIGN superseded task files without correcting them | 010/017/018 corrected in place (2026-07-19); staleness rule honored | Stages 3, 6 |
| No machine-readable API contract at launch | OpenAPI generated from `@hono/zod-openapi` route definitions for all surfaces, committed + drift-asserted (Phase-4 machinery pulled forward; `x-stability: internal`) | Stage 6 (017, 027) |
| a2-react-aria's shadcn-style distribution (registry + CLI, vendored components) not reflected; design-guideline ownership unstated | ADR-22: `@a2ra/core` exact-pinned; components vendored via `@a2ra/cli`; A2UI spec = core Zod schemas; single UI stack lint-enforced; design tokens single-sourced upstream | Stages 4, 7, 8a (011, 028, 031) |
| No feature-flag mechanism; Turnstile activation ad hoc | ADR-24: typed env-driven flag registry in config; per-form settings tier; Turnstile behind flag + form setting | Stages 6–8a (017, 026, 029, 033) |

---

## Stage 0 - Repository bootstrap · `features/001`

Monorepo skeleton so every later stage lands in its final home: pnpm workspaces + Turborepo; `packages/{core,a2ui-compiler,db,ui}` and `apps/{api,portal,admin}` created empty with build/test/lint wired; TypeScript strict everywhere; Vitest as the single runner; ESLint + Prettier; Changesets; CI running typecheck + test + lint on every push; `docker-compose.dev.yml` providing Postgres; MIT license, README stub, scope documents committed.

**Exit:** `pnpm build && pnpm test` green across empty packages in CI; a fresh clone reaches running Postgres and a passing pipeline in two commands.

## Stage 1 - Domain schema · `features/002–004`

`@qcms/core` part 1. Branded ID types, `LocalizedText`, and - **decided here, not later** - the canonical `AnswerValue` encoding per question type (dates as timezone-less ISO `YYYY-MM-DD`; numbers as finite IEEE doubles; choice answers as `optionId` / `optionId[]`; booleans as JSON booleans; text as NFC-normalized strings). Then the seven question-type definitions with constraints, the `FormDefinition` structure (steps, pinned `{questionId, version}` refs), and the typed `PublishError` model. Types, schemas, and exhaustive parsing tests only - no rendering, storage, or HTTP.

**Exit:** hand-written kitchen-sink and insurance fixtures parse; a suite of invalid fixtures fails for the right, asserted reasons; `AnswerValue` encodings documented in `DOMAIN_SCHEMA.md`.

## Stage 2 - Rules DSL and evaluator · `features/005–007`

The closed operator set (incl. the multiChoice containment operators `contains`/`containsAny`, ADR-21) as Zod schemas with nesting capped at 8; the rule dependency-graph utilities (references, targets, document-order positions - the machinery ADR-16 validation needs); the pure evaluator `evaluateRules(snapshot, answers) → FlowState` implementing **single forward-pass semantics**; then the test corpus - property-based determinism/totality tests plus golden files covering every operator, nesting, and the insurance branching flow.

**Exit:** golden fixtures cover every operator and nesting; evaluator is total (never throws on valid input; typed errors otherwise); ADR-16 semantics documented with worked examples, including the hidden-answer-exclusion cases.

## Stage 3 - Publish aggregate, answer validation, secure links · `features/008–010`

`compileDraft(draft) → PublishResult`: atomic validation (rule resolution against pinned versions, no dangling refs, default-locale completeness, **acyclic forward-only rule graph**) returning a deep-frozen snapshot - with semantics version stamped - or all typed errors. `validateAnswer(question, value)` per type and the submission-lock semantics (visible-required sweep, hidden-answer exclusion). Secure-link token mint/verify as pure functions over supplied key material. The kernel is now feature-complete for launch and has never touched I/O.

**Exit:** every invariant I1–I9 has a test that violates it; snapshots deep-frozen and structurally versioned; kernel coverage effectively total; token forge/expiry/wrong-form tests pass.

## Stage 4 - A2UI compiler · `features/011–012`

`@qcms/a2ui-compiler`: pure projection FormDefinition → A2UI documents, one per step; question-type → component mapping; constraints surfaced as client-side hints; locale resolution via default locale; output stamped with `compilerVersion` + `a2uiSpecVersion` (ADR-18). The golden corpus: reviewed golden documents for the fixtures, committed under an **append-only** policy, doubling as the renderer's conformance input. The step-resolver seam interface documented with a stub test double.

**Exit:** kitchen-sink fixture compiles to reviewed golden output; compiler deterministic and side-effect-free; corpus policy (never delete, only add) enforced by CI check; seam documented.

## Stage 5 - Storage · `features/013–016`

`@qcms/db`: Drizzle schema and migrations for the full operational skeleton (questions/versions, forms/drafts, form_versions with version stamps, sessions, append-only answers, submissions, erasure_tombstones, outbox with delivery state, better-auth tables); real-Postgres integration harness (testcontainers) in CI; query helpers including latest-answer-per-question and outbox claim (`FOR UPDATE SKIP LOCKED`); the `reporting.responses` view in its first documented form, excluding erased sessions; retention sweep; and the ADR-17 erasure implementation with tombstone.

Changesets releases begin: `core`, `a2ui-compiler`, `db` cut pre-1.0 versions as soon as the API consumes them.

**Exit:** migrate-from-zero and migrate-forward both tested in CI; no UPDATE path exists for answers (enforced and tested); reporting view documented as the SQL contract; erasure removes content, preserves tombstone, and disappears from the view; sweep tested.

## Stage 6 - API · `features/017–027`

Hono composition root: mount flags, error envelope, structured logging, rate limiting, `/health` + `/ready`, and the in-process schedulers (outbox deliverer, retention sweep) started here - not in handlers. Then vertical slices, respondent path first: `start-session` (anonymous + secure-link verification), `get-step` (stored compiled A2UI + flow state), `submit-answer` (kernel validate → ledger insert → re-evaluate), `submit` (visible-required sweep → lock → outbox in one transaction). Authoring path, headless: question CRUD/versioning/deprecation, draft CRUD, `publish` (kernel compile → snapshot persist), response listing/export (CSV/JSON), erasure, secure-link minting, webhook config. The webhook deliverer with HMAC signing, exponential backoff, dead-letter flagging, manual redeliver endpoint. Abuse basics: session-token binding, per-session/per-IP limits, honeypot, min-time checks. Handlers fetch-pure; slice tests via `app.request()` with no ports.

**Exit:** a scripted end-to-end test drives a branching form from session start to submission and observes the signed webhook fire, over HTTP against the composed app; the same suite passes under the public/internal mount split; a poisoned webhook endpoint produces a visible dead-letter that redelivers successfully; generated OpenAPI documents for both surfaces are committed, valid, and drift-asserted in CI.

## Stage 7 - Portal · `features/042 (wireframes), 028–030`

The A2UI renderer in `packages/ui` - `A2Renderer` (`@a2ra/core`, exact-pinned) over a2ra components vendored via the CLI (ADR-22) - conformance-tested against the Stage 4 golden corpus (every document, every spec version). The Next.js portal: SSR step pages via strict BFF route handlers (sessions, credentials, proxying - nothing else), hydration into the renderer, resume-by-session, anonymous + secure-link entry, error/completion states, Turnstile adapter slot (null default). Accessibility is in-scope here: focus management on branch changes, `aria-live` step/error announcements, full keyboard traversal, axe in CI, first manual NVDA + VoiceOver pass on the kitchen-sink form.

**Exit:** a respondent completes kitchen-sink and insurance fixtures on a mid-tier phone over throttled network with SSR first paint; screen-reader pass logged with issues fixed or ticketed; Lighthouse a11y 100 on flow pages.

## Stage 8a - Admin: authoring · `features/031–035, 041`

better-auth sign-in **with TOTP 2FA**; question library (create, edit, version, deprecate - manual pinning per the cut-line); form builder composing pinned questions into steps; **structured-JSON condition editor with live kernel validation** (the default per ADR-19 - not a fallback); publish flow surfacing kernel errors verbatim; live preview through the shared renderer; version history; secure-link generation UI; response browsing, CSV/JSON export, erasure with confirmation + tombstone display; webhook configuration with delivery history, dead-letters, and redeliver. Then **041 - agent-assisted form building** (ADR-25): chat panel in the builder, `DraftAssistant` provider adapter behind `QCMS_FLAG_AGENT_AUTHORING`, agent proposals kernel-validated and human-published; **off the launch gate** - 038 never waits for it.

**Exit:** the full authoring loop works end to end in the browser; publish errors render as actionable messages pointing at the offending question/rule; preview DOM deep-matches the portal renderer's output for the fixtures (shared-renderer assertion per 034, not screenshots).

## Stage 8b - Distribution → **public launch** · `features/036–038, 040`

Production Dockerfiles for all three apps; the solo `docker-compose.yml` (portal · admin · api · postgres - TLS/ingress operator-supplied per ADR-20, with a documented cloud-LB recipe and an optional Caddy overlay) with healthchecks; the enterprise mount-flag/VPN recipe; backup/restore documentation **with a tested restore drill**; structured-log conventions documented; the `create-qcms-app` scaffolding CLI stamping the owned shell - with the explicit fallback that launch may proceed from documented manual setup if the CLI lags (ADR-19). Then the **security review (040)**: the `SECURITY_DESIGN.md` assurance pass - authorization-matrix tests, token/rotation verification, header/cookie/CSRF checks, secrets redaction, dependency and image scans, ASVS-oriented review - executed after 036 and gating 038.

**Launch gate (exit):** the full loop - scaffold → run → author → publish → respond → export/webhook - performed by someone who is not the author of the code, following only the README. Task 038 is that validation, run as a scripted checklist with an external tester.

## Stage 9 - Post-launch seams · `features/039`

Demand-ordered, never pre-built: OTP + social via better-auth; library cascade UX (outdated-pin surfacing → breaking-change classification → impact analysis); `/api/v1` with scoped tokens and generated OpenAPI when a real integrator asks; locale-switching UX; agent-assisted authoring behind the compiler seam; **file-upload question type**; visual condition builder; Bun on evidence. Task 039 records each as a `phase-4` issue with acceptance sketch - the itch ledger the cut-line requires.

---

## Working agreements

**Definition of done, every task:** tests written with the code (kernel property/golden tests, API slice tests, renderer conformance tests), including **e2e coverage at the highest layer that exists for the feature - HTTP scenarios for headless work, a passing Playwright spec for anything browser-facing (ADR-23)**; documentation updated in the same PR; discipline rules R1–R7 hold - a task violating them is not done regardless of function.

**The cut-line is enforced at review, not remembered:** no impact analysis, no `/api/v1`, no second locale, no BFF logic before their stage. Itches become `phase-4` issues.

**Versioning from Stage 5 onward:** publishable packages cut pre-1.0 releases via Changesets as soon as the API consumes them, so the adopter upgrade path is exercised from the start.

**UI tasks are screens-first (042's gate):** structure is decided in `docs/wireframes/` (042 - ASCII illustrative, region/state inventories normative, human-signed) before any UI task runs. Each browser-facing task then lands its screens as **static renders of the fixtures first** - real vendored components, dead controls - captures a Playwright screenshot set (screen × state × theme), and gets human sign-off against the wireframe **before wiring behavior**. The approved static screen is the start of the implementation, not a throwaway.

**Agent execution protocol:** each `features/` file is self-contained instructions for one agent session. Before starting a task: read `PROJECT_INSTRUCTIONS.md`, the task file, and any files its *Depends on* header lists as contracts. After finishing: run the full test suite, update docs named in the task, and record any out-of-scope discovery as an issue - never expand the task.

## Risk register (standing)

1. **Rules-DSL semantics ossifying too early** - mitigated: semantics version stamped in every snapshot from day one (task 008); ADR-16 fixed the launch semantics deliberately.
2. **Admin builder scope creep toward deferred cascade features** - mitigated: the cut-line agreement; structured editor as default (ADR-19).
3. **A2UI / a2-react-aria co-evolution** - mitigated: append-only golden corpus is the inter-project contract (ADR-18); version stamps make breakage explicit; change either side against the corpus deliberately. Vendored components + the exact `@a2ra/core` pin mean upstream changes reach qcms only via deliberate, conformance-gated `a2ra diff` upgrades (ADR-22).
4. **Solo-developer stall in the long UI stages (7–8a)** - mitigated: fine-grained task files keep increments small; respondent portal ships before admin, so a usable demo exists early.
5. **Dependency abandonment or paid-pivot** - watch items: `better-auth` and `drizzle-orm` (both young and VC-funded). Mitigated by mechanisms, not hope: narrow usage behind owned seams (auth lives in shell config with a documented swap recipe, `docs/auth-swap.md`; Drizzle is used without magic - plain-SQL migrations, thin helpers); Renovate + osv-scanner surface staleness and vulnerabilities continuously (SEC-11); CONTRIBUTING's dependency policy (thresholds + per-PR risk assessment, mirrored from `a2-react-aria`) gates every addition.
