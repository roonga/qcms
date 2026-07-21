# QCMS - Project Goal

**Status:** v1.5 (formal) · supersedes the prose description in project metadata · v1.1–v1.5 add ADR-20…25 (2026-07-19 review)
**License:** MIT · **Companion documents:** `ARCHITECTURE.md` · `IMPLEMENTATION_PLAN.md` · `DOMAIN_SCHEMA.md` · Scope v2 decision record (ADR-01…25)

---

## 1. Vision

QCMS is an MIT-licensed, TypeScript, open-source engine for questionnaires, surveys, and registration flows with **deeply conditional logic** - the answer to one question determines which questions follow (the motivating example: insurance sign-up, where "are you a smoker?" opens a follow-up branch).

It is distributed in the **shadcn ethos**: adopters do not install a product, they scaffold an application into their own repository and own the source. The invariant machinery - domain model, rules engine, publish compiler, migrations - ships as versioned npm packages they upgrade like any dependency.

The project is also a proof point: **a single developer with AI leverage can ship what used to take a SaaS team.**

## 2. Audiences

| Audience | What they do | Surface |
|---|---|---|
| **Form authors** | Curate a governed question library; compose forms; define branching rules; publish and version; review responses; export | Admin app (VPN/internal) |
| **Respondents** | Complete flows anonymously or via signed secure links; resume in-progress sessions; on any device, with assistive technology | SSR portal (public) |
| **Downstream systems** | Receive submissions via signed webhook; pull via CSV/JSON export or the documented read-only reporting view in Postgres | Webhook · export · `reporting.*` views |
| **Adopters / operators** | Scaffold, theme, extend, and self-host the system with a small-team operability budget | `create-qcms-app` scaffold · docker-compose · docs |

## 3. Non-negotiable properties

These three properties shape every architectural decision and are never traded away:

1. **Immutability.** Published form versions are frozen forever. Sessions pin the version they started on and never migrate. Referenced question versions never change.
2. **Determinism.** The serving path contains no LLM and no nondeterministic component. Same form version + same answers = same flow and same UI, forever. Rule evaluation is a pure function whose semantics are versioned with each snapshot.
3. **Auditability.** The system can always answer: *what was asked, what was shown, what was answered, and when it changed.* Immutable snapshots store both the domain definition and the compiled UI; answers are an append-only ledger.

A fourth property is a first-class commitment rather than a differentiator: **accessibility** (WCAG 2.2 AA, built during development, verified per release with automated and manual passes).

## 4. Success criteria

### Launch (end of Phase 3)

- A person who did not build the system can, following only the README: scaffold the app, run it with docker-compose, author and publish a branching form, complete it as a respondent, and receive the export and signed webhook. **This is the launch gate.**
- The kitchen-sink reference form (every question type) and the insurance fixture (branching) pass: automated axe checks, Lighthouse accessibility 100 on flow pages, and a logged manual NVDA + VoiceOver pass.
- A respondent completes a flow on a mid-tier phone over a throttled network with SSR first paint.
- The full loop runs on the solo topology: four containers - portal, admin, API, Postgres - with TLS/ingress supplied by the operator (ADR-20).
- Erasure of a respondent's data is possible via a documented, tested path (ADR-17).

### Post-launch (Phase 4, demand-ordered)

Adoption signals decide sequencing, not the roadmap: OTP/social login, question-library cascade UX (impact analysis), `/api/v1` with scoped tokens and generated OpenAPI, locale-switching UX, agent-assisted authoring behind the compiler seam, file-upload question type, Bun runtime on evidence.

## 5. Scope boundaries (the cut-line)

Launch **includes**: the seven core question types (short text, long text, number, date, boolean, single choice, multi choice); the closed rules DSL; question-level versioning with manual pinning; anonymous + secure-link access; append-only answers with resume; submission lock; signed webhook with transactional outbox; CSV/JSON export; reporting view; retention sweep and hard-erasure path; admin authoring with structured condition editing; **flag-gated agent-assisted form building (ADR-25 - built for launch, off the launch gate)**; single locale on a localizable schema; single-tenant deployments.

Launch **excludes** (recorded as `phase-4` issues, never built early): impact analysis / breaking-change detection, `/api/v1`, second locale UX, multi-tenancy, OTP/social auth, runtime agent flows **in the serving path** (adaptive flows - the `StepResolver` seam stays reserved), file-upload question type, visual drag-and-drop condition builder beyond the structured editor.

**The cut-line is enforced at review, not remembered.** An itch is written down as an issue labeled `phase-4`, not scratched.

## 6. Decision record - additions

ADR-01…15 are recorded in Scope v2. The following decisions were added after the plan reviews (ADR-16…19: 2026-07-18; ADR-20…25: 2026-07-19; ADR-26: 2026-07-21) to resolve identified underspecifications. They carry the same weight.

### ADR-16 - Rules evaluation: forward-pass with publish-time cycle rejection

**Decision.** Rule evaluation is a **single forward pass in document order**, not an unconstrained fixpoint. A rule's `show` targets must appear **later in document order** than every question the rule's condition references. `compileDraft` builds the rule dependency graph and rejects, with typed errors, any draft containing a cycle or a backward-pointing target.

**Why.** Excluding hidden questions' answers from evaluation makes an unconstrained fixpoint potentially non-monotone (visibility can oscillate; no unique fixpoint exists). Forward-only evaluation is trivially deterministic and total, matches how respondents actually experience a form, and is checkable at publish time. Backward or cyclic targeting can only return as a *versioned semantics change* - never silently.

**Consequences.** DOMAIN_SCHEMA §3 "pure fixpoint" language is superseded: evaluation is a pure single pass over `(snapshot, answers)`. The open item "may `show` target future steps only?" is resolved: forward-only, enforced at publish.

### ADR-17 - GDPR erasure: hard-delete with tombstone

**Decision.** `@qcms/core` defines an erasure operation, `@qcms/db` implements it: given a `sessionId`, delete all ledger rows and any submission record, and write a **tombstone** `(sessionId, formVersionId, erasedAt, reason)` preserving that a response existed without preserving its content. Form snapshots are untouched - they contain no respondent data. The reporting view excludes erased sessions by construction. The API exposes erasure on the admin surface only.

**Why.** Right-to-erasure requests are inevitable in the target domains (insurance, registration). Hard delete is simple, testable, and honest. Crypto-shredding was considered and rejected for launch: more machinery for a stronger "physically append-only" story nobody has yet asked for. The append-only rule (R3/I5) is amended: *append-only, except whole-session erasure* - there is still no UPDATE path, ever.

**Consequences.** Erasure lands with storage (Stage 5) and admin exposure (Stage 8a). Webhook consumers are documented as independent data controllers - erasure does not propagate downstream.

**Amendment (2026-07-20, from Stage 5 implementation - issue #4).** Retention purge (`purgeExpired`, task 015) is a **second sanctioned whole-session DELETE path**, distinct from GDPR erasure: it deletes expired-never-submitted sessions at whole-session granularity, preserves I5 (no partial delete, no UPDATE), and writes **no** tombstone (nothing was ever submitted to attest). The earlier "the sole DELETE door is whole-session erasure" language is superseded - there are **two** sanctioned whole-session DELETE doors (`eraseSession`, `purgeExpired`), enforced by the same scoped trigger mechanism, and there is still **no UPDATE path, ever**. GDPR erasure remains the only door that leaves a tombstone.

### ADR-18 - Serving uses the audit copy; snapshots stamp compiler and spec versions

**Decision.** The portal serves the **stored compiled A2UI documents** - exactly what was frozen at publish. Every `FormVersion` records `compilerVersion` and `a2uiSpecVersion` alongside the compiled output. The renderer maintains backward compatibility with every spec version ever published, enforced by the golden-document conformance suite: golden documents are **never deleted**, only added.

**Why.** "Prove exactly what was rendered" is the audit promise; recompile-on-read would let the served UI drift from the audit record. The cost - renderer backward compatibility - is made explicit and testable rather than discovered later. A2UI and `a2-react-aria` are young and co-evolve with this project; the version stamps and the immutable golden corpus are the contract between them.

**Consequences.** The conformance suite is append-only. A future breaking A2UI change means a new spec version rendered alongside the old, not a migration of stored snapshots.

### ADR-19 - Launch splits Stage 8; scaffolding CLI is not on the launch gate

**Decision.** The original Stage 8 is split: **8a Authoring** (question library, form builder, structured-JSON condition editor with live validation, publish, preview, versions, responses, export, webhooks config, erasure, 2FA) and **8b Distribution** (production images, compose recipes, ops docs, `create-qcms-app`). The condition editor ships as **structured JSON editing with validation as the default**, not the fallback; a visual builder is Phase 4. Launch may proceed from a documented manual setup if the CLI lags - the launch gate is the README loop, not the CLI.

**Why.** The original Stage 8 bundled roughly 40% of the project into the stage gating launch. The DSL was explicitly designed (ADR-03) so a structured editor is sufficient; taking it as the default removes the largest scope risk in the plan.

### ADR-20 - Solo topology: no bundled proxy; admin is the fourth app container

**Decision.** The solo `docker-compose.yml` runs **portal · admin · api · postgres**. No reverse proxy ships as a standing container: TLS termination, HSTS, and routing are **operator-supplied ingress** - a cloud load balancer (e.g. ECS + ALB) or the optional single-VM Caddy overlay (`docker-compose.proxy.yml`, auto-certs) that 036 ships as a recipe. The API container **publishes no host port**: it is reachable only by the two BFFs on the compose-internal network. Ingress routes only portal and admin.

**Why.** The original topology bundled a proxy but omitted the admin app entirely - the launch gate's authoring loop had nowhere to run. Ingress is vendor-shaped infrastructure adopters already own (the shadcn ethos), and moving it out keeps the four-container budget honest while making "the API is never publicly routable" a property of the compose file rather than of proxy-configuration discipline.

**Consequences.** `SECURITY_DESIGN.md` B1/SEC-9 now read "TLS terminates at the operator's ingress"; both ingress recipes state the apps assume TLS; local eval runs plain HTTP on localhost (cookie `Secure` flags are production-conditional by design). Admin in solo is protected by TLS + better-auth 2FA (SEC-1) rather than a VPN - already anticipated by trust boundary B4.

### ADR-21 - MultiChoice comparison semantics; `contains` / `containsAny` operators

**Decision.** Value equality for `equals`/`notEquals`/`in` is defined per canonical encoding; for `multiChoice` arrays it is **set equality** (order- and duplicate-insensitive - the canonical encoding is already deduplicated). Two operators join the closed DSL before `semanticsVersion 1` freezes: **`contains`** (true when the multiChoice answer includes the given `optionId`) and **`containsAny`** (true when it includes at least one of the listed `optionId`s). Both are type-valid only against `multiChoice` questions, enforced at publish (`RULE_TYPE_MISMATCH`).

**Why.** The most common multiChoice branching - "show a follow-up if the respondent selected X, among others" - was inexpressible in the closed set, and array equality was undefined while freezing into snapshots, goldens, and exports. Semantics that freeze into data are decided in documents, not by whichever agent reaches them first (`AGENTIC_DEVELOPMENT.md` §1.4).

**Consequences.** `DOMAIN_SCHEMA.md` §2.4/§3 define value equality and the new operators; tasks 002 (`valuesEqual`), 005 (schemas + type checks), 006 (evaluation), 007 (corpus) carry them. Numbers compare by IEEE equality - authoring docs warn against `equals` on non-integer number questions.

### ADR-22 - UI stack: the `a2-react-aria` co-evolution contract

**Decision.** Both frontends build exclusively on the org's own `a2-react-aria` stack, matching its shadcn-style distribution:

- **`@a2ra/core`** (A2Renderer, component registry, Zod schemas) is an **exact-pinned npm dependency**; the a2ra *components* are **vendored source** in `packages/ui`, added via `npx @a2ra/cli add` (`a2ra.json` committed there). `A2UIStepRenderer` composes `A2Renderer` with a `createRegistry` over the vendored components (never `defaultRegistry` - lean bundle, explicit surface).
- **The A2UI spec is `@a2ra/core`'s Zod schemas.** `a2uiSpecVersion` records the schema version of the pinned `@a2ra/core`; the compiler's output is validated against those schemas in tests (dev-dependency only - the compiler package stays React-free at runtime).
- **No other component library** may be imported in `packages/ui`, portal, or admin - enforced by lint/import-surface test, like the R-rules. (General-purpose libraries, that is - a specialized widget with no a2ra equivalent, e.g. 033's CodeMirror-based JSON editor, is a deliberate, task-recorded exception.)
- **Design language is single-sourced upstream:** shadcn-convention CSS custom-property tokens per `a2-react-aria`'s styling guide; qcms themes by setting tokens in shell globals and writes no parallel design guidelines. The upstream docs (styling guide + component pages) are required reading for 011/028/031–035.
- **Upgrades are events:** upstream component changes arrive only via reviewed `a2ra diff` pulls; any change to vendored components or the `@a2ra/core` pin must leave the golden-corpus conformance suite green. Component-level accessibility is tested upstream; flow-level accessibility (focus on branch changes, announcements) is qcms's (029/030). Gaps remain cross-repo issues filed in both repos - never local workarounds that fork the design language.

**Why.** Same org, co-evolving repos (`@a2ra/core` is at `1.0.0-preview.x`). Vendoring is what makes ADR-18's forever-backward-compatibility *enforceable locally*: upstream changes cannot reach published forms until deliberately pulled and conformance-tested - the vendored copy in `packages/ui` **is** the renderer the audit promise depends on. One component stack keeps admin preview fidelity honest and stops a future session from "just adding" a second library for a missing widget.

**Consequences.** 011's mapping targets real registry component names; 028 vendors components instead of importing them; 031's admin kit reuses the same vendored set (the registry already carries `table`, `dialog`, `menu`, `tabs`). Where the registry lacks a component a question type needs (candidates visible today: multiline text for `longText`, a checkbox group for `multiChoice`), the fix is an upstream contribution first - the two projects evolve together. Two dependencies follow from this stack and are part of it, not additions to argue over: **Tailwind CSS** (vendored component styles are Tailwind utilities over token custom properties - wired in `packages/ui` and both apps) and **React 19** (`@a2ra/core`'s peer requirement, which pins Next to a React-19-capable major). Zod stays on one aligned major across the workspace and `@a2ra/core` (compiled documents are validated against its schemas).

### ADR-23 - Testing architecture: four layers, Playwright pinned for e2e

**Decision.** Two runners, fixed: **Vitest** for everything below the browser; **Playwright** is the only browser/e2e framework. The layers, bottom-up:

1. **Unit** (Vitest): kernel property tests (fast-check), golden files for frozen semantics, pure-function tests; `@qcms/db` helpers against Testcontainers Postgres.
2. **Component** (Vitest + testing-library + axe, jsdom): the renderer conformance suite over the golden corpus is the component layer for `packages/ui` and its vendored a2ra components; admin kit primitives get the same treatment (031). No Storybook in qcms - upstream `a2-react-aria` owns component exploration.
3. **API scenario** (Vitest, `app.request()`, real Postgres): per-slice tests plus the 027 HTTP scenario suite - the end-to-end layer for the headless stages.
4. **Browser e2e** (Playwright): portal and admin flows; root config and CI job established in 029 and extended by every later UI task; axe-via-Playwright and the Lighthouse gate (030) ride on it.

**Every feature lands with e2e coverage at the highest layer that exists for it, in the same PR:** kernel/db/API features extend the scenario suite; browser-facing features ship a passing Playwright spec. A feature without its e2e test is not done, regardless of unit coverage.

**Why.** Playwright was already the de facto choice in 029–035; pinning it prevents a future session introducing test-framework variety. The layer map keeps the testability gradient honest - cheap, deterministic layers carry the bulk of coverage; Playwright carries user-visible truth. "Highest layer that exists" makes the e2e rule meaningful in Stages 1–6 without pretending browsers exist before Stage 7.

**Consequences.** `CONTRIBUTING.md` testing conventions restated to two-runner form; 001 stays Playwright-free (the toolchain lands with the first browser surface, 029); human gates (030's screen-reader pass, 038's launch gate) sit above layer 4 - agent-prepared, human-executed.

### ADR-24 - Feature flags: a typed env-driven registry; Turnstile is the first flagged feature

**Decision.** One flag mechanism, two tiers, and an explicit line between them:

- **Deployment flags** - a **typed flag registry** inside 017's Zod config schema: every flag is declared in code (name, type, default, description) and parsed from `QCMS_FLAG_*` env vars at boot. Unknown or malformed flags fail fast, like any config error. Flags flow through `deps` (API) and server-only config (BFFs); **there is no client-side flag evaluation** - clients see flag *effects* (server-rendered behavior), never flag values. First entries: `QCMS_FLAG_CHALLENGE_PROVIDER` (`none` default | `turnstile`) and the existing `QCMS_ADMIN_2FA` escape hatch, retrofitted into the registry.
- **Per-form settings** - form-scoped toggles (`challengeRequired`, min-time floor - 026) are *domain configuration*, not feature flags: they live on the form record, are edited in the form builder, and version with drafts like any other field. This tier exists in the ADR precisely so nobody builds flag infrastructure when a form setting is wanted, or vice versa.
- **Turnstile sits behind both tiers:** the deployment flag selects the challenge provider - its secrets (`TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`) are required by config validation *iff* the provider is `turnstile`, and the portal CSP gains the Turnstile origin only when active (SEC-9). The per-form setting decides which forms challenge. With provider `none`, `challengeRequired` is unenforceable: start-session no-ops (026's null verifier) and the admin UI warns when the toggle is set without a configured provider.
- **Lifecycle discipline:** flags exist for operator opt-ins and dark-launching genuinely risky changes - not A/B testing (not an analytics product, §8) and not permanent config sprawl. A dark-launch flag gets a removal issue at creation. Every flag is documented for free via 036's generated env reference. **No DB-backed dynamic flag service at launch** - runtime toggling without restart is a Phase-4 item behind the registry seam (the registry reads from a provider interface; env is the only provider shipped).

**Why.** 12-factor env flags cost zero new services (the operability budget), reuse the fail-fast config machinery 017 already builds, and self-document through the generated env reference. Turnstile is the model citizen: a proprietary vendor service that must never be load-bearing - off by default at the deployment tier, opt-in per form at the domain tier, with its CSP surface and secrets existing only when switched on.

**Consequences.** 017 gains the registry and conditional Turnstile secret validation; 026's seam wording references the provider flag; 029 gates rendering on flag + form setting; 033 gains the form-settings panel (with the no-provider warning); 039 records the runtime flag provider as a Phase-4 item.

### ADR-25 - Agent-assisted form building: launch feature, flag-gated, off the launch gate

**Decision.** Admin users can build forms agentically: a chat panel in the form builder where an LLM agent proposes question definitions and a draft `FormDefinition`, delivered as task **041** (Stage 8a). The governing principle: **the agent proposes, the kernel validates, the human publishes.**

- **Not the `StepResolver` seam.** That seam is for agent-*adaptive serving* and stays reserved for Phase 4. Authoring assistance is a different, safer feature: the agent is just another author emitting domain JSON - the closed DSL was explicitly designed for machine emitters (ADR-03).
- **Mechanics:** a fetch-pure API slice `POST /admin/forms/:id/draft/assist` behind a `DraftAssistant` provider adapter (vendor-shaped, like the challenge adapter), implemented **once** on a vendor-agnostic LLM layer (the Vercel AI SDK - 041) so provider support is configuration, not per-vendor code. Activated by `QCMS_FLAG_AGENT_AUTHORING` (`none` default | a provider id - `anthropic` is the documented reference; OpenAI-compatible endpoints cover local models), with `QCMS_AGENT_API_KEY` required by config validation iff enabled (ADR-24 pattern). The generated admin OpenAPI document (027) supplies the agent's tool definitions.
- **Guardrails:** the agent's tool allowlist covers draft mutation, draft-question creation, and validation **only** - it can never publish, erase, mint links, configure webhooks, or read responses (the PII boundary: form structure goes to the provider, respondent data never does). Every proposal runs 022's advisory validation; acceptance merges into the draft for human review in the builder + preview; publish remains a human act gated by `compileDraft`, unchanged.
- **Off the launch gate (ADR-19 pattern):** 041 is built for launch but 038's external-tester loop does not require it - launch may proceed with the flag dark. The launch gate never acquires an LLM-provider setup step.

**Why.** The architecture already makes this safe and cheap: kernel validation means agent output is exactly as trustworthy as human input, and the serving path's determinism (§3) is untouched because agents exist only at authoring time. The project premise - one developer with AI leverage - and `a2-react-aria`'s AI-native positioning make agentic authoring the demo differentiator; the flag + off-gate placement keeps it from ever blocking launch.

**Consequences.** §5's cut-line moves: agent-assisted *authoring* is launch scope (flag-gated); runtime agent *flows* remain excluded. §8's "not an LLM-at-runtime product" stands verbatim - serving is untouched. 039 item 5 narrows to adaptive serving. `ARCHITECTURE.md` §12 gains the `DraftAssistant` seam row. The provider key joins the SEC-7 inventory.

### ADR-26 - Admin/portal UI stack: client data/state, and the two-surface design mandate (extends ADR-22)

**Decision.** ADR-22 fixed the component layer; this resolves what it left open for the UI apps (029, 031-035, 041).

- **Server-state:** **TanStack Query in the admin only** (query cache, mutations, optimistic updates, invalidation) over the admin app's same-origin BFF routes. The **portal stays fetch-only** (SSR-first, minimal client state). The strict BFF (R2) keeps the API internal on both surfaces regardless of client library.
- **Client editor state (builder):** a scoped `useReducer`/context store for the draft, dirty-tracking, and undo - **not** a new global-state dependency (Zustand/Redux/Jotai) unless the builder proves it needs one. Inputs use **react-aria's form primitives**, not a separate form library.
- **Design mandate, by surface:** the **portal is adopter-themeable** - a refined, brand-neutral default that adopters re-skin (fonts + tokens) at deploy time through one documented override point, and it is **mobile-first** (respondents are on phones). The **admin is an internal tool with QCMS's own fixed identity** - designed screens/patterns on the a2ra primitives, not adopter-re-branded.
- **Theming:** light + dark, both **WCAG 2.2 AA**, on both surfaces, via the a2ra shadcn token convention; semantic color is separate from the brand accent.

**Why.** The admin is client-heavy (autosave, live validation, optimistic updates, cross-view cache invalidation) - exactly where a query cache beats hand-rolled server-state, and where the minimal-dependency rule favors the library (the builder's server-state is well over a hundred lines of liability). The portal is SSR-first with trivial client state, so it pays for none of it. The two surfaces serve different masters: respondents see the *adopter's* brand (the portal must flex), authors see *ours* (the admin can be opinionated and fixed).

**Consequences.** One new runtime dependency, **admin-only**: `@tanstack/react-query` (clears the CONTRIBUTING thresholds - major org, open source, vendor-agnostic; exit path bounded, it is a cache over `fetch`). 031-035 build against this stack. The design pass (`docs/wireframes` + the design brief) produces the token set and admin designs; the first pass validated **Cobalt** as the QCMS brand accent with a themeable portal baseline (2026-07-21). Portal fonts + tokens are the single adopter override surface.

## 7. Constraints

- **Team:** one developer, part-time to full-time, using agentic AI workflows for leverage. Every stage must land a meaningful, testable increment; exit criteria gate stages, not dates.
- **Stack (fixed by ADRs):** Node LTS · pnpm + Turborepo · Zod as the single schema language · Hono (vertical slices, fetch-pure handlers) · Next.js portal (SSR + strict BFF) · Next.js admin (separate app) · Postgres + Drizzle · better-auth · a2-react-aria as the only UI component stack (`@a2ra/core` pinned + vendored components + Tailwind for their token-based styles, ADR-22) · TanStack Query (admin server-state, ADR-26) · Vitest · Docker. All components open source, vendor-agnostic, multi-cloud.
- **Operability budget:** the solo deployment is four containers including the database (portal, admin, API, Postgres - ADR-20; TLS/ingress is operator infrastructure). If a feature demands a fifth standing service, it is probably out of scope.
- **Discipline rules R1–R7** (Scope v2 §04, restated in `PROJECT_INSTRUCTIONS.md`) are never violated and never relitigated. R3's append-only clause is amended by ADR-17 as noted.

## 8. What this project is not

Not a SaaS (though a multi-tenant derivative remains a documented recipe). Not a form-painting WYSIWYG competing on drag-and-drop. Not an analytics product - it hands clean data to tools that are. Not an LLM-at-runtime product - agents may assist *authoring* (launch, flag-gated, ADR-25); they never sit in the serving path.
