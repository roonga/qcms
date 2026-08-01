# QCMS - Project Instructions (read first, every session)

**Status:** v2.6 · supersedes v1 · reflects the formal plan set (2026-07-18, last amended 2026-08-01) including ADR-01…35 and SEC-1…13

**This file lives at the repo root.** Every reference document listed below is under `docs/`, except `CONTRIBUTING.md`, which is also at the root.

You are working on **QCMS**: an MIT-licensed, TypeScript, open-source engine for questionnaires, surveys, and registration flows with conditional logic, distributed in the shadcn ethos (owned scaffolded shell + versioned core packages).

## Reference documents (authoritative set - nothing outside it wins)

- `docs/PROJECT_GOAL.md` - vision, audiences, launch gate, cut-line, **ADR-01…35**
- `docs/ARCHITECTURE.md` - system design, component/repo layout (§13 full tree), ops commitments
- `docs/DOMAIN_SCHEMA.md` (v1.2) - domain model, rules DSL, **ADR-16 evaluation semantics**, invariants I1–I11
- `docs/SECURITY_DESIGN.md` - authn/authz/scopes, token & key inventory, **SEC-1…13**, traceability matrix
- `docs/IMPLEMENTATION_PLAN.md` (v2) - Stages 0–9 with exit criteria and gap-resolution table
- `docs/AGENTIC_DEVELOPMENT.md` - methodology and the **session protocol you follow (§3)**
- `CONTRIBUTING.md` (repo root) - **coding standards, testing conventions, git/PR rules, the merge gate** (binding for every change)
- `docs/COMPONENT_GUIDELINES.md` - **binding for adding or changing any input control**: vendoring fidelity, the registry/adapter contract, the ADR-31 commit-moment row, conformance/keyboard/no-JS/focus coverage, token compliance
- `docs/features/` - numbered task files: your work orders. `docs/features/README.md` holds the index, progress ledger, ordering exceptions, and execution protocol.

Consult before proposing designs; **never silently contradict an ADR or SEC decision - flag conflicts instead.** Where an older doc conflicts with a newer one, the newer wins and the older gets fixed in the same change.

## Stack (fixed by ADRs - not open for relitigation)

Node LTS everywhere · pnpm + Turborepo · Zod as the single schema language · Hono API (vertical slices, fetch-pure handlers) · Next.js portal (SSR + strict BFF) · Next.js admin (separate app, BFF) · Postgres + Drizzle · better-auth (admin 2FA at launch) · a2-react-aria as the only UI component stack (`@a2ra/core` pinned + vendored components + Tailwind for their token styles - ADR-22; A2UI documents are for compiled form steps only, admin screens are ordinary React on the same components) · Vitest below the browser + Playwright as the only e2e framework (ADR-23: every feature ships e2e at the highest layer that exists for it) · Docker.

## Discipline rules - never violate, never relitigate

- **R1** Published versions are immutable; sessions pin the version they started on.
- **R2** No business logic in a BFF - portal/admin route handlers do sessions, credentials, proxying only.
- **R3** `@qcms/core` never imports the db; slices load state, pass it in, persist results. Answers are append-only - no UPDATE path exists; the sole DELETE door is whole-session erasure (**ADR-17 amendment**).
- **R4** API handlers stay fetch-pure - no Node-only APIs (WebCrypto, not `node:crypto`).
- **R5** Invariant spanning more than one field/row → core function; otherwise plain transaction script. No repositories-as-interfaces, no mediator, no NestJS.
- **R6** `questionId`/`optionId` are stable forever and never reused with a different meaning.
- **R7** The launch cut-line holds: no impact analysis, no `/api/v1`, no second locale, no multi-tenancy, no visual rule builder before Phase 4. Record itches as `phase-4` issues; don't build them.

And from the newer decisions: rule evaluation is a **forward pass, never a fixpoint** (ADR-16); the portal serves the **stored compiled A2UI, never a recompilation** (ADR-18); the golden corpus is **append-only** (ADR-18); multiChoice comparisons are **set equality** and containment uses `contains`/`containsAny` (ADR-21); the solo topology has **no bundled proxy** - TLS/ingress is operator infrastructure and the API container is never published (ADR-20); both frontends use **only** the `a2-react-aria` stack - `@a2ra/core` exact-pinned, components vendored via the a2ra CLI, design tokens single-sourced upstream, no other component library ever (ADR-22); feature flags are the typed env registry only - no client-side flag evaluation, no flag service; form-scoped toggles are form settings, not flags (ADR-24); agents assist **authoring only** - the agent proposes, the kernel validates, the human publishes; the serving path never sees an LLM and the agent's tool surface never reaches respondent data (ADR-25); security controls follow `docs/SECURITY_DESIGN.md` - notably: no CORS headers ever, answer values never logged, secrets never echoed.

And from ADR-26…35 (titles and rationale in `docs/PROJECT_GOAL.md` §6): client data/state and the two-surface design mandate extend ADR-22 (**ADR-26**); i18n is first-class in both apps and **no user-facing string is ever hardcoded** (**ADR-27**); the portal uses an **explicit step cursor** (Continue/Back/Submit), never collapse-on-answer (**ADR-28**); the **dev container is the canonical environment** and `scripts/agent-loop.sh` is the only supervisor (**ADR-29**, amended 2026-07-25); portal theming is managed themes + respondent runtime controls over a four-group token contract (**ADR-30**); answer commitment semantics and conditional reveal cadence are fixed (**ADR-31**); validation messages are author-supplied with edit-level default fallback (**ADR-32**); retraction is a **tombstone append**, never a delete (**ADR-33**); observability is an OTel baseline with trace-correlated logs and the SEC-13 redaction allowlist (**ADR-34**); the **API is the sole domain-data client**, the admin's auth handle being the one scoped exception, itself closing in task 056 (**ADR-35**).

## Session protocol (normative - AGENTIC_DEVELOPMENT.md §3 in brief)

1. Read this file → your task file in `docs/features/` → its listed references. Check the progress ledger and `git log`; trust the repo over memory.
2. Work only within the task's deliverables and exit criteria; **out-of-scope sections are binding**. Blocked on a real decision → stop and ask; never choose silently.
3. Tests ship with the code; docs named in the task update in the same change.
4. Leave the repo **green or clean**: done = all exit criteria pass and **`pnpm verify`** is green at the repo root (add **`pnpm verify:browser`** when the change touches `apps/portal`, `apps/admin`, or `@qcms/ui`); not done = revert or park on the task branch with a `HANDOFF.md`. Never merge red. Gate contents and the CI mapping: `CONTRIBUTING.md`.
5. One branch per task (`feat/NNN-slug`); Conventional Commits with task number; PR description = exit-criteria checklist; Changeset for package changes. Full rules: `CONTRIBUTING.md`.
6. **The ledger row is not yours to flip mid-task.** The pushed `origin/feat/NNN-*` branch is the claim; the row goes `todo` -> `done (PR #N)` exactly once, in the completing PR. Under the `/task` flow the orchestrator lands that change, never the executor.

## Working agreements

- Follow `docs/features/` numeric order; the ordering exceptions live in one place only, the table in `docs/features/README.md`. A task is done only when its exit criteria pass.
- Accessibility is in-scope during build (WCAG 2.2 AA, axe in CI, focus management on branch changes), not a post-launch pass.
- Prefer boring defaults; when a fork appears, propose the seam-preserving option and record the decision as a new ADR.
- Versioning via Changesets from Stage 5 (task 013) onward.

## Owner context

Solo developer; experienced full-stack (deep enterprise ASP.NET background, Next.js as FE); newer to agentic workflows. Explain unfamiliar TS-backend idioms briefly when introducing them; map to .NET concepts where a mapping exists.
