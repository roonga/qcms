# QCMS project instructions

QCMS is an MIT-licensed TypeScript engine for questionnaires, surveys, and registration flows with conditional logic.

## Authoritative documents

- `docs/PROJECT_GOAL.md`: vision, launch scope, and ADRs
- `docs/PORTS.md`: port allocation and seat usage
- `docs/ARCHITECTURE.md`: system and repository design
- `docs/DOMAIN_SCHEMA.md`: domain model, rule semantics, and invariants
- `docs/SECURITY_DESIGN.md`: security controls and traceability
- `docs/IMPLEMENTATION_PLAN.md`: delivery stages and exit criteria
- `docs/AGENTIC_DEVELOPMENT.md`: agent workflow
- `CONTRIBUTING.md`: coding, testing, git, PR, and merge rules
- `docs/COMPONENT_GUIDELINES.md`: rules for input controls
- `docs/features/`: numbered work orders and the progress ledger

Read the relevant documents before changing code. Trust the live repository over memory. If current requirements conflict, flag the conflict and update the affected documents when the Code Owner decides it.

## Fixed stack

Node LTS, pnpm, Turborepo, Zod, Hono, Next.js, Postgres, Drizzle, better-auth, `a2-react-aria`, Vitest, Playwright, and Docker. Do not introduce a competing framework or component library without an ADR.

## Core rules

- **R1:** Published versions are immutable. A new session resolves the newest published version by default or an exact published version when its public or secure link pins one. The session stays pinned to that starting version.
- **R2:** BFF handlers manage sessions, credentials, and proxying only. Business logic belongs elsewhere.
- **R3:** `@qcms/core` never imports the database. Answers are append-only. Erasure and retention purge are the only whole-session delete paths.
- **R4:** API handlers remain Fetch API pure. Use WebCrypto, not Node-only APIs.
- **R5:** Put multi-field or multi-row invariants in core functions. Otherwise use plain transaction scripts. Do not add repository interfaces, a mediator, or NestJS.
- **R6:** `questionId` and `optionId` are stable and never reused with a different meaning.
- **R7:** Respect the launch cut-line. Defer impact analysis, `/api/v1`, a second locale, multi-tenancy, version-targeted links, and a visual rule builder to Phase 4.
- **R8:** Use the allocation in `docs/PORTS.md`. Never invent a port.

## Architecture constraints

- Rule evaluation is one forward pass, never a fixpoint. The portal serves stored compiled A2UI.
- The golden corpus is append-only. Multi-choice comparison uses set equality; containment uses `contains` or `containsAny`.
- TLS and ingress are operator infrastructure. The API container is not published.
- Both frontends use the `a2-react-aria` stack. A2UI is for compiled form steps; admin screens use ordinary React.
- Feature flags use the typed environment registry. Form settings are not feature flags.
- Agents may assist authoring only. The kernel validates, a human publishes, and no LLM enters the serving path or respondent data path.
- No CORS headers. Never log answer values or expose secrets.
- User-facing strings are localized. The portal uses an explicit Continue, Back, and Submit cursor.
- Retraction is a tombstone append. The API is the sole domain-data client; both frontends proxy through BFF handlers.
- Observability follows the OTel baseline and security redaction allowlist.

## Work protocol

1. Read this file, the work order, and its references. Check the ledger, open work, and `git log`.
2. Stay within deliverables and exit criteria. Ask the Code Owner when a real decision is required.
3. Ship tests and named documentation with the code.
4. Leave the repository green or park incomplete work on its branch with `HANDOFF.md`.
5. Use one branch per task or issue and follow `CONTRIBUTING.md` for commits, changesets, PRs, and gates.
6. A pushed branch is the claim. Change a task ledger row only in its completing PR.
7. An independent reviewer subagent reviews the exact PR head. The root conductor records the head-bound `AGENT-REVIEW` verdict and performs the merge.

Accessibility is part of implementation. Prefer simple defaults, preserve established seams, and record substantive architectural changes as ADRs.

The Code Owner is a solo full-stack developer with deep ASP.NET experience and less familiarity with TypeScript backend patterns. Briefly map unfamiliar patterns to .NET concepts when useful.
