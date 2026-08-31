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

**Note (flagged).** There is still no DSL **version** constant, and `@qcms/core` has never been published, so "versioned core change" remains a review convention rather than a released number.

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

**Note (flagged - code gap).** The `semanticsVersion` gate runs only at submit. The serve and answer paths evaluate a bare definition without checking the stored stamp (`apps/api/src/features/responses/serve-step/handler.ts`), so a snapshot recorded under superseded semantics would be served and branched by the new evaluator and fail only at submit. The stamp is also stored as text and numerically coerced at submit.

**Amendment - required means non-blank (Code Owner, 2026-08-31, issue #128).** A question is answered when it holds a **non-blank** value: an empty or whitespace-only text value is absence, for the `answered` operator, for every value operator, and for the required accounting alike. The stored value is never rewritten - trimming decides the presence test only, so a respondent's `" "` stays verbatim in the ledger and in exports.

This was corrected **within `semanticsVersion` 1** rather than under a bump, and the reasoning is part of the decision. A bump cannot deliver what this ADR's rule protects: the evaluator implements one version at a time and refuses any other stamp, so `2` would not preserve old snapshots' behavior, it would make every published snapshot fail at submit. Multi-version evaluation is the missing prerequisite, and it is the code gap noted above. Against that, no answer the product can produce changes meaning: both control boundaries have reported an emptied field as absence since issue #98, and the same batch made `""` and `[]` unstorable at the API (ADR-33). One golden scenario that had pinned `""` as answered was amended in place; `packages/core/golden/evaluator/CORPUS.md` records that as a defect-correction precedent and not as licence to edit a golden that disagrees with an intended semantics change.

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

### ADR-09 - Route groups are topology controls

**Status:** implemented.

**Decision.** API route groups are mounted explicitly. An unmounted group does not exist and returns 404 rather than relying on an authorization check.

**Note.** Four groups ride three mount flags (the auth group mounts with `admin`), and mounting also installs the SEC-4 internal-token gate, so a mount is a topology control plus a channel gate.

### ADR-10 - Reporting before public API

**Status:** implemented.

**Decision.** Launch integrations are signed webhooks, exports, and documented read-only reporting views. A stable `/api/v1` pull API is Phase 4.

**Note.** "Read-only" for the reporting views is an operator GRANT recipe (`docs/reporting-view.md`), not a shipped role migration.

### ADR-13 - Fetch-pure vertical slices

**Status:** implemented.

**Decision.** The Hono API uses fetch-pure vertical slices with explicit dependencies. Multi-field and multi-row invariants live in core functions; other work uses plain transaction scripts. Background delivery and retention jobs run inside the API process.

**Note.** The schedulers start only where the internal surface is mounted (in the solo topology, always). Fetch purity is lint-enforced for `@qcms/core` and the compiler but convention-only in `apps/api`. Retention now runs three rules: the session sweep plus the aged redaction of response snippets (#304) and outbox payloads (#329).

### ADR-15 - Runtime baseline

**Status:** implemented.

**Decision.** QCMS targets Node LTS. Experimental runtime flags are not part of the supported execution model.

### ADR-17 - Erasure, retention, and outbox copies

**Status:** implemented; amended 2026-08-02 (task 059) and widened by issues #304 and #305.

**Decision.** Erasure is form-scoped and, in one transaction: deletes the session's answer ledger and submission, retains the session row as a scrubbed shell, writes a content-free tombstone, redacts QCMS's outbox payload and every stored delivery response snippet, and cancels undelivered deliveries. Delivered or in-flight downstream copies cannot be recalled. Retention purge is the other sanctioned whole-session delete path and leaves no tombstone because the session was never submitted; the retention scheduler also ages out outbox payloads and response snippets on time limits. `docs/erasure.md` is the operational contract.

### ADR-24 - Typed deployment flags

**Status:** implemented; see note.

**Decision.** Deployment flags are declared in a typed environment registry and parsed at boot. Unknown or malformed flags fail fast. Clients receive behavior, not flag values. Per-form settings are domain configuration, not feature flags.

**Note (flagged).** The admin settings response deliberately echoes the raw `challengeProvider` flag value so the settings panel can warn when `challengeRequired` is unenforceable - a standing exception to "behavior, not flag values" this record should either bless or remove. The registry covers feature flags only; the rest of the environment is typed and fail-fast but hand-parsed, and unknown-key rejection fires only on the `QCMS_FLAG_` prefix.

### ADR-35 - API-only database access

**Status:** implemented; amended 2026-07-31 (task 056).

**Decision.** The API is the only application process with a database handle, including better-auth storage. Admin and portal have no database dependencies or credentials and reach data through BFF calls. Auth endpoints are explicitly allowlisted; self-registration is absent.

## Identity and security

### ADR-06 - Separate admin and respondent identity

**Status:** implemented.

**Decision.** Admin authentication uses better-auth with email, password, TOTP, recovery codes, and no self-registration. Respondents use anonymous sessions or secure links at launch. Secure-link token functions stay pure; key storage stays in the shell.

**Note.** The instance is hosted in the API since ADR-35's 2026-07-31 amendment. The shipped instance also enforces a breach-corpus password check (#178) and a sign-in throttle (#374, #390); `docs/SECURITY_DESIGN.md` is authoritative for those controls.

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

**Note.** The shared surface is a triple - compiler, `documentForVisible` projection, and renderer - all taken from `@qcms/ui` by both apps.

### ADR-22 - One UI component stack

**Status:** implemented.

**Decision.** Both frontends use `a2-react-aria`: `@a2ra/core` is exact-pinned and components are vendored into `@qcms/ui`. No competing component library is allowed. Upgrades are reviewed events and must preserve golden-document conformance.

**Note.** The competing-library lint fence covers `packages/ui` only; the apps hold the rule by consuming `@qcms/ui/kit`. Vendor-tree fidelity is a reviewed artifact (`packages/ui/a2ra-diff.md`), not an automated gate.

### ADR-26 - Different frontend decisions by surface

**Status:** implemented; see note.

**Decision.**

- **Admin:** internal, desktop-primary, QCMS-branded, client-heavy, and allowed to use TanStack Query plus scoped editor state.
- **Portal:** public, mobile-first, adopter-themed, SSR-first, and fetch-only with minimal client state.
- **Shared:** the a2ra component stack, WCAG 2.2 AA, semantic tokens, and the renderer used for form content and previews.

**Note (flagged).** TanStack Query has never been adopted; the admin's server-state mechanism is Next server components plus Server Actions, which this record does not mention. The admin bullet needs a Code Owner amendment to name the shipped mechanism.

### ADR-27 - Internationalization in both apps

**Status:** implemented.

**Decision.** User-facing chrome comes from app catalogs; authored content comes from `LocalizedText`. Dates, numbers, and currency use `Intl`. Additional translations and a runtime locale switcher are Phase 4, but the localization machinery is launch scope.

**Note.** The admin has a locale constant and format module; the portal does not - its one formatted value inlines `en-US` while the admin uses `en`, so a second portal locale currently means editing a component. No currency value exists in the domain yet; that clause is forward-looking.

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
