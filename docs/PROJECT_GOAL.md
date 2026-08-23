# QCMS - Project Goal

**Status:** authoritative
**License:** MIT · **Companion documents:** `ARCHITECTURE.md` · `IMPLEMENTATION_PLAN.md` · `DOMAIN_SCHEMA.md`

---

## 1. Vision

QCMS is an MIT-licensed, TypeScript, open-source engine for questionnaires, surveys, and registration flows with **deeply conditional logic** - the answer to one question determines which questions follow (the motivating example: a vehicle insurance quote, where "any at-fault accident in the last 3 years?" opens a follow-up branch).

It is distributed in the **shadcn ethos**: adopters do not install a product, they scaffold an application into their own repository and own the source. The invariant machinery - domain model, rules engine, publish compiler, migrations - ships as versioned npm packages they upgrade like any dependency.

The project is also a proof point: **a single developer with AI leverage can ship what used to take a SaaS team.**

## 2. Audiences

| Audience                 | What they do                                                                                                                 | Surface                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Form authors**         | Curate a governed question library; compose forms; define branching rules; publish and version; review responses; export     | Admin app (VPN/internal)                           |
| **Respondents**          | Complete flows anonymously or via signed secure links; resume in-progress sessions; on any device, with assistive technology | SSR portal (public)                                |
| **Downstream systems**   | Receive submissions via signed webhook; pull via CSV/JSON export or the documented read-only reporting view in Postgres      | Webhook · export · `reporting.*` views             |
| **Adopters / operators** | Scaffold, theme, extend, and self-host the system with a small-team operability budget                                       | `create-qcms-app` scaffold · docker-compose · docs |

## 3. Non-negotiable properties

These three properties shape every architectural decision and are never traded away:

1. **Immutability.** Published form versions are frozen forever. Sessions pin the version they started on and never migrate. Referenced question versions never change.
2. **Determinism.** The serving path contains no LLM and no nondeterministic component. Same form version + same answers = same flow and same UI, forever. Rule evaluation is a pure function whose semantics are versioned with each snapshot.
3. **Auditability.** The system can always answer: _what was asked, what was shown, what was answered, and when it changed._ Immutable snapshots store both the domain definition and the compiled UI; answers are an append-only ledger.

Two further properties are first-class commitments rather than differentiators: **accessibility** (WCAG 2.2 AA, built during development, verified per release with automated and manual passes) and **internationalization** (ADR-27): **no user-facing string is ever hardcoded** - both the portal and the admin render every string through the app's i18n catalog or `LocalizedText` (authored content), and dates, numbers, and currency are formatted locale-aware via `Intl`. The system is multiple-language-capable; the initially shipped translation set may be small, but nothing is hardcoded. **Typography is held to the same bar (mandate):** every font QCMS offers - the default plus every built-in accessibility/visibility option - must be **open-licensed and self-hostable** (OFL / Apache-2.0 or equivalent permissive; no proprietary or paid fonts, no runtime font-CDN dependency), so any deployment can legally ship and self-host it. **Google Fonts is the canonical source** - its whole library qualifies, so prefer it. A font outside Google Fonts may be offered only if it meets the same bar and its license notice is documented alongside the self-hosted asset (e.g. OpenDyslexic, OFL-1.1). Offered fonts follow accessible-typography guidance: generous x-height, unambiguous letterforms (distinct `I`/`l`/`1`, non-mirrored `b`/`d`), adequate weight, plus broad script coverage for i18n; and the portal honors the WCAG 1.4.12 spacing floors (>= 16px body, >= 1.5 line-height, >= 0.12em letter-spacing, >= 0.16em word-spacing).

## 4. Success criteria

### Launch (end of Phase 3)

- A person who did not build the system can, following only the README: scaffold the app, run it with docker-compose, author and publish a branching form, complete it as a respondent, and receive the export and signed webhook. **This is the launch gate.**
- The kitchen-sink reference form (every question type) and the insurance fixture (branching) pass: automated axe checks, Lighthouse accessibility 100 on flow pages, and a logged manual NVDA + VoiceOver pass.
- A respondent completes a flow on a mid-tier phone over a throttled network with SSR first paint.
- The full loop runs on the solo topology: four containers - portal, admin, API, Postgres - with TLS/ingress supplied by the operator (ADR-20).
- Erasure of a respondent's data is possible via a documented, tested path (ADR-17).

### Post-launch (Phase 4, demand-ordered)

Adoption signals decide sequencing, not the roadmap: OTP/social login, question-library cascade UX (impact analysis), `/api/v1` with scoped tokens and generated OpenAPI, locale-switching UX, adaptive agent serving behind the compiler seam, named custom themes, version-targeted public and secure links, file-upload question type, and Bun runtime on evidence.

## 5. Scope boundaries (the cut-line)

Launch **includes**: the seven core question types (short text, long text, number, date, boolean, single choice, multi choice); the closed rules DSL; question-level versioning with manual pinning; anonymous + secure-link access; append-only answers with resume; submission lock; signed webhook with transactional outbox; CSV/JSON export; reporting view; retention sweep and hard-erasure path; admin authoring with structured condition editing; **flag-gated agent-assisted form building (ADR-25 - built for launch, off the launch gate)**; **full internationalization on both apps** (no hardcoded user-facing text; locale-aware dates/numbers/currency; multiple-language-capable, ADR-27); single-tenant deployments.

Launch **excludes** (recorded as `phase-4` issues, never built early): impact analysis / breaking-change detection, `/api/v1`, large shipped locale-translation sets and a runtime locale-switcher UX (the i18n machinery is launch scope, ADR-27; additional translations are demand-ordered), multi-tenancy, OTP/social auth, runtime agent flows **in the serving path** (adaptive flows - the `StepResolver` seam stays reserved), the named custom-theme editor, version-targeted public and secure links, file-upload question type, and a visual drag-and-drop condition builder beyond the structured editor.

**The cut-line is enforced at review, not remembered.** An itch is written down as an issue labeled `phase-4`, not scratched.

## 6. Decision record

Decisions are surface-specific unless explicitly shared. The **admin** is an internal authoring and operations tool. The **portal** is the public respondent experience. A choice made for one surface does not automatically apply to the other.

### ADR-01 - Domain-first compiled UI

**Decision.** `FormDefinition` is the source of meaning. A pure compiler projects each published snapshot to A2UI documents. Storage and rendering consume those outputs and never redefine domain behavior.

### ADR-02 - Versioned question library

**Decision.** Questions are governed, versioned entities. `questionId` is stable identity, versions are immutable content, and published forms pin exact question versions.

### ADR-03 - Closed rules DSL

**Decision.** Branching uses a closed, typed JSON DSL. New operators are versioned core changes. The format must remain machine-emittable and publish-time validatable.

### ADR-04 - Single-tenant core

**Decision.** QCMS ships as a single-tenant deployment. Multi-tenancy is a derivative recipe, not a schema or runtime cost imposed on the core.

### ADR-05 - Owned shell, versioned invariants

**Decision.** Adopters own scaffolded routes, pages, adapters, and themes. Domain rules, the compiler, migrations, and other audit-sensitive machinery ship as versioned packages.

### ADR-06 - Separate admin and respondent identity

**Decision.** Admin authentication uses better-auth with email, password, TOTP, recovery codes, and no self-registration. Respondents use anonymous sessions or secure links at launch. Secure-link token functions stay pure; key storage stays in the shell.

### ADR-07 - Pinned sessions and submission lock

**Decision.** A session pins one published form version for its lifetime. Answers append to a ledger. Submission validates visible required questions, excludes hidden answers, and locks the resulting answer set.

### ADR-08 - Separate frontends, shared renderer

**Decision.** Admin and portal are separate Next.js applications with different product needs. Both use strict BFF handlers and the same QCMS renderer for form content, so admin previews match the respondent portal.

### ADR-09 - Route groups are topology controls

**Decision.** API route groups are mounted explicitly. An unmounted group does not exist and returns 404 rather than relying on an authorization check.

### ADR-10 - Reporting before public API

**Decision.** Launch integrations are signed webhooks, exports, and documented read-only reporting views. A stable `/api/v1` pull API is Phase 4.

### ADR-11 - Localizable content model

**Decision.** Human-readable domain content uses `LocalizedText`. Published snapshots carry localized content; application chrome uses app catalogs. Launch may ship one locale, but adding locales must not require a schema migration.

### ADR-12 - Accessible abuse controls

**Decision.** Rate limits, session binding, honeypots, and timing checks are the baseline. A typed challenge-provider adapter is optional and off by default. Visible challenges are not the default.

### ADR-13 - Fetch-pure vertical slices

**Decision.** The Hono API uses fetch-pure vertical slices with explicit dependencies. Multi-field and multi-row invariants live in core functions; other work uses plain transaction scripts. Background delivery and retention jobs run inside the API process.

### ADR-14 - Step resolver seam

**Decision.** `StepResolver` is the compiler extension seam. The shipped resolver is pure and deterministic. Future adaptive behavior must preserve the stored-output contract and cannot put an LLM in the serving path.

### ADR-15 - Runtime baseline

**Decision.** QCMS targets Node LTS. Experimental runtime flags are not part of the supported execution model.

### ADR-16 - Forward-only rule evaluation

**Decision.** Rules evaluate once, in document order. A rule may show only targets that appear after every question it reads. Publish rejects backward targets and cycles. A semantic change requires a new snapshot `semanticsVersion`.

### ADR-17 - Erasure, retention, and outbox copies

**Decision.** Erasure deletes a session's answer ledger and submission, writes a content-free tombstone, redacts QCMS's outbox payload, and cancels undelivered deliveries. Delivered or in-flight downstream copies cannot be recalled. Retention purge is the other sanctioned whole-session delete path and leaves no tombstone because the session was never submitted.

### ADR-18 - Serve the stored audit copy

**Decision.** The portal serves the compiled A2UI documents stored at publish time. Each form version records compiler, A2UI spec, and rule-semantics versions. Golden documents and renderer compatibility are append-only.

### ADR-19 - Launch delivery split

**Decision.** Authoring and distribution are separate delivery stages. Structured condition editing is the launch editor; a visual builder is Phase 4. The README launch loop may use documented setup if the scaffolding CLI is not ready.

### ADR-20 - Four-container solo topology

**Decision.** The default deployment runs portal, admin, API, and Postgres. The API publishes no host port. TLS, HSTS, and routing belong to operator-provided ingress; an optional proxy recipe is not a standing product container.

### ADR-21 - Multi-choice comparison

**Decision.** Multi-choice equality is set equality. `contains` tests one option and `containsAny` tests a set of options. Publish rejects those operators against non-multi-choice questions.

### ADR-22 - One UI component stack

**Decision.** Both frontends use `a2-react-aria`: `@a2ra/core` is exact-pinned and components are vendored into `@qcms/ui`. No competing component library is allowed. Upgrades are reviewed events and must preserve golden-document conformance.

### ADR-23 - Test layers

**Decision.** Vitest covers unit, component, database, and API scenario tests. Playwright is the only browser framework. Every feature adds coverage at the highest available layer; browser-facing work requires a passing browser flow.

### ADR-24 - Typed deployment flags

**Decision.** Deployment flags are declared in a typed environment registry and parsed at boot. Unknown or malformed flags fail fast. Clients receive behavior, not flag values. Per-form settings are domain configuration, not feature flags.

### ADR-25 - Agent-assisted authoring only

**Decision.** A flag-gated admin assistant may propose questions and form drafts. The kernel validates every proposal and a human publishes it. The assistant cannot publish, erase, manage links or webhooks, or read response data. It is built for launch but does not gate launch; the serving path never uses an LLM.

### ADR-26 - Different frontend decisions by surface

**Decision.**

- **Admin:** internal, desktop-primary, QCMS-branded, client-heavy, and allowed to use TanStack Query plus scoped editor state.
- **Portal:** public, mobile-first, adopter-themed, SSR-first, and fetch-only with minimal client state.
- **Shared:** the a2ra component stack, WCAG 2.2 AA, semantic tokens, and the renderer used for form content and previews.

### ADR-27 - Internationalization in both apps

**Decision.** User-facing chrome comes from app catalogs; authored content comes from `LocalizedText`. Dates, numbers, and currency use `Intl`. Additional translations and a runtime locale switcher are Phase 4, but the localization machinery is launch scope.

### ADR-28 - Explicit portal navigation

**Decision.** Continue advances only after current-step validation, Back returns to the previous visible step and is hidden on the first step, and Submit appears only on the last visible step. Answering never changes the rendered step by itself.

### ADR-29 - One root conductor

**Decision.** The Dev Container is the canonical development environment. One root conductor owns the task end to end and delegates bounded implementation and exact-head review to subagents. All agents share repository state as their working context.

### ADR-30 - Portal theming

**Decision.** Launch includes predefined deployment themes, brand configuration, a four-group token contract (color, typography, spacing, radius), and respondent choices for mode, font, and density. High contrast is a shared mode layer rather than a per-theme palette. The admin editor for creating and saving named custom themes is **Phase 4**.

### ADR-31 - Answer commitment

**Decision.** The server remains the only rule evaluator. The portal commits controls at these moments:

| Control                       | Commit moment                              |
| ----------------------------- | ------------------------------------------ |
| boolean, single choice        | on change                                  |
| short text, long text, number | on blur                                    |
| date                          | when editing ends and the date is complete |
| multi-choice                  | when focus leaves the group                |

Clearing or partially editing a previously answered date commits a retraction. Same-step visibility updates only after the relevant commit.

### ADR-32 - Authored validation messages

**Decision.** Authors may supply localized messages per question constraint. Blank fields inherit catalog defaults. Stable validation codes remain authoritative; authored messages are presentation content compiled into the form document.

### ADR-33 - Answer retraction

**Decision.** Clearing an answer appends a retraction record; it never mutates an answer row. Latest-answer reads resolve a retraction to unanswered for rules, validation, reporting, and export. Empty text and empty selections are absence, not answers. Whole-session deletion remains governed by ADR-17.

### ADR-34 - OpenTelemetry baseline

**Decision.** API, admin, and portal use official OpenTelemetry instrumentation at composition roots for W3C trace propagation, OTLP traces, and allowlisted trace-correlated application logs. With no OTLP endpoint, telemetry is a hard no-op. Browser telemetry, custom metrics, and identifier hashing are Phase 4. No collector ships in the base topology.

### ADR-35 - API-only database access

**Decision.** The API is the only application process with a database handle, including better-auth storage. Admin and portal have no database dependencies or credentials and reach data through BFF calls. Auth endpoints are explicitly allowlisted; self-registration is absent.

### ADR-36 - Authored boolean labels

**Decision.** Boolean questions may provide localized `yesLabel` and `noLabel` values with catalog fallback. Stored answers remain booleans and rule, reporting, and export semantics do not change.

### ADR-37 - Port allocation

**Decision.** `QCMS_PORT_SEAT` selects one port-allocation index. Stable services use `7Sxx`; ephemeral harnesses use `17Sxx`. The exact table and runbook live only in `docs/PORTS.md`, and `pnpm check:ports` enforces the allocation. The development-tools overlay may use the stable dashboard and database-viewer slots defined there.

### ADR-38 - Theme scope carrier

**Decision.** Theme and font token sheets target `:is(:root, [data-qcms-theme-scope])`. Component treatments target descendants of the bare carrier attribute. This lets admin previews render portal tokens and treatments without restyling admin chrome, while preserving existing root-based adopter overrides.

### ADR-39 - Link version targeting

**Decision.** Admins choose a target policy when distributing a public or secure link: **Always latest** resolves the newest published version when a respondent starts, while **Pin to version** resolves one selected published version. Existing public and secure links retain Always latest behavior. Every created session remains pinned to the version it resolved at start and never migrates.

The public Always latest address is `/f/{slug}`. A pinned public address is `/f/{slug}/v{version}` and is available only for a published version. Distribution state lives outside the immutable snapshot: each pinned public address may be open, redirected to Always latest, or closed with a localized explanation. The whole-form closed state overrides every public and secure link.

Secure links keep their signed, expiring, optionally one-time invitation model. Their server-side state stores either Always latest or an exact published version; the token format does not carry the version. Existing secure-link rows default to Always latest. Public version-address state does not govern a secure invitation, which has its own revocation lifecycle. Revocation, expiry, one-time consumption, challenge checks, and abuse controls are unchanged.

## 7. Constraints

- **Team:** one developer, part-time to full-time, using agentic AI workflows for leverage. Every stage must land a meaningful, testable increment; exit criteria gate stages, not dates.
- **Stack (fixed by ADRs):** Node LTS · pnpm + Turborepo · Zod as the single schema language · Hono (vertical slices, fetch-pure handlers) · Next.js portal (SSR + strict BFF) · Next.js admin (separate app) · Postgres + Drizzle · better-auth · a2-react-aria as the only UI component stack (`@a2ra/core` pinned + vendored components + Tailwind for their token-based styles, ADR-22) · TanStack Query (admin server-state, ADR-26) · Vitest · Docker. All components open source, vendor-agnostic, multi-cloud.
- **Operability budget:** the solo deployment is four containers including the database (portal, admin, API, Postgres - ADR-20; TLS/ingress is operator infrastructure). If a feature demands a fifth standing service, it is probably out of scope.
- **Discipline rules R1–R8** (defined in `PROJECT_INSTRUCTIONS.md`) are never violated and never relitigated. R3's append-only clause is amended by ADR-17 as noted.

## 8. What this project is not

Not a SaaS (though a multi-tenant derivative remains a documented recipe). Not a form-painting WYSIWYG competing on drag-and-drop. Not an analytics product - it hands clean data to tools that are. Not an LLM-at-runtime product - agents may assist _authoring_ (launch, flag-gated, ADR-25); they never sit in the serving path.
