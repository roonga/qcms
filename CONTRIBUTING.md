# Contributing to Question CMS

**Status:** v1.0 · applies to human and agent contributors alike · committed to the repo root at bootstrap (task 001)
**Companions:** `PROJECT_INSTRUCTIONS.md` (read first) · `AGENTIC_DEVELOPMENT.md` §3 (session protocol) · `SECURITY_DESIGN.md` · `apps/api/CONTRIBUTING.md` (slice-level conventions, task 017)

## Ground rules

The reference documents in `docs/` are authoritative; the discipline rules R1–R7 and decisions ADR-01…25 / SEC-1…12 are not relitigated in PRs — a PR that violates them is not mergeable regardless of quality. Conflicts with a decision are raised as an issue proposing a new ADR, never resolved silently in code. The launch cut-line (R7) applies to contributions: out-of-scope features become `phase-4` issues, not PRs.

## Coding standards

### TypeScript

- Strict mode everywhere (`tsconfig.base.json` is not weakened per-package).
- **Domain types are inferred from Zod schemas** (`z.infer`) — never hand-written in parallel. One schema, one type, one place.
- No `any`. `unknown` at trust boundaries, narrowed by parsing (Zod), not by `as`. Every `as` cast and every `eslint-disable` needs a one-line justification comment; unexplained ones fail review.
- Exported functions declare explicit return types (inference is fine internally).
- Discriminated unions + exhaustive `switch` with a `never` check — adding a variant must break the build until handled.
- Expected failures return typed results (`Result`/`ok|err` with coded errors, all-errors-not-first in validators); exceptions are for bugs only and never cross a package boundary as control flow.

### Style and structure

- **Functional core:** `packages/*` are pure functions over immutable data — no classes for domain logic, no internal state, no I/O in `core`/`a2ui-compiler` (R3/R4). Dependencies are explicit parameters; no DI container, no service locator (.NET mapping: think static pure methods + explicit `deps` records, not `IServiceCollection`).
- Naming: files kebab-case; types/schemas PascalCase (schema and inferred type share a name); functions/variables camelCase; module-level constants SCREAMING_SNAKE only when truly global (`SEMANTICS_VERSION`).
- Imports: packages expose a public API via their index; no deep imports across package boundaries; no circular dependencies (enforced by lint); `apps/*` never import each other.
- Lint rules live in the **root flat config** (`eslint.config.js`); per-package additions only for package-specific import-surface rules (e.g. core's no-db-import). Formatting is owned by Prettier and never discussed in review. Lint rules are the standard — if a convention matters, encode it as a rule or import-surface test, don't police it by hand.
- Comments explain *why*, not *what*. JSDoc on exported package APIs. Every `TODO` references an issue number; free-floating TODOs fail review.

### Dependencies (mirrors `a2-react-aria`'s approval policy)

- **Approval thresholds — before adding (or even suggesting) any package or tool, verify it meets one:**

| Criteria | Threshold |
| --- | --- |
| **Official** | Maintained by the primary org behind the tool (Adobe for React Aria, Microsoft for Playwright, …) |
| **Popular npm package** | ≥ 5,000 GitHub stars and/or ≥ 500,000 weekly npm downloads |
| **Explicitly approved** | Reviewed by the owner and recorded in the approved list below |

  Do not assume popularity — check stars/downloads. Below every threshold: stop, state the concern, and ask before proceeding.
- **Runtime dependencies carry a risk assessment in their PR:** maintenance health (bus factor, release cadence), governance (who funds it; paid-pivot risk), and the exit path if it is abandoned or rug-pulled. Dev/test-only dependencies need only the threshold check.
- **Minimal-dependency policy stands:** prefer the platform (WebCrypto over a JWT library — task 010 is the reference pattern). A dependency that saves under a hundred lines is a liability, not a convenience.
- **Accepted-with-noted-risk list** (deliberate acceptances; the watch items of risk register #5):

| Package | Risk noted | Why accepted / exit path |
| --- | --- | --- |
| `better-auth` | Young, VC-funded; auth-cloud pivot is the classic risk shape | Narrow scope used (email+password, TOTP, sessions); all data in our own Postgres; swap recipe `docs/auth-swap.md` (031) |
| `drizzle-orm` | Young, VC-funded | No magic used — migrations are plain SQL files, helpers are thin; exit to Kysely/raw SQL is bounded |
| `ai` (Vercel AI SDK) + `@ai-sdk/*` | Vercel-owned — same steering/churn profile as Next/Turborepo | Vendor-agnostic LLM layer for 041 only; confined behind the `DraftAssistant` seam, so a swap touches one adapter file |

### Testing

- **Two runners, fixed (ADR-23):** Vitest for everything below the browser (unit, component, API slices/scenarios); **Playwright is the only browser/e2e framework** — specs live in `apps/{portal,admin}/e2e/`. No other test frameworks, ever.
- Tests co-located (`foo.test.ts` beside `foo.ts`); names state behavior ("rejects backward rule targets"), not method names.
- Right tool per layer: property tests (fast-check) for pure logic; golden files for frozen semantics (change = version bump, never a quiet regen); testing-library + axe for components (the renderer conformance suite is the component layer); `app.request()` for API slices; Testcontainers for storage; Playwright for browser flows.
- **Every feature lands with e2e coverage at the highest layer that exists for it, in the same PR (ADR-23):** kernel/db/API features extend the HTTP scenario suite (027-style); anything with a browser surface ships a passing Playwright spec. A feature without its e2e test is not done, regardless of unit coverage.
- Don't mock our own packages — slices test against the real kernel; mocks are for genuine externals (HTTP receivers, clocks).
- Coverage: `@qcms/core` effectively total (≥95% lines, exclusions justified in code); elsewhere, every exit criterion and every bug fix has a test. A bug fix without a regression test is incomplete.

### Security (binding, from SECURITY_DESIGN)

No secrets in code, fixtures, or logs; answer values never logged; queries parameterized via Drizzle only (no SQL string interpolation); WebCrypto, never `node:crypto`, in fetch-pure code; no CORS headers, ever; new dependencies follow the Dependencies policy above (thresholds + risk assessment in the PR).

## Git and PR rules

- **Branches:** `feat/NNN-slug` for plan tasks, `fix/slug`, `docs/slug`, `chore/slug` otherwise. Never force-push `main`; force-push your own branch freely before review.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`); include the task number for plan work (`feat(core): 006 forward-pass evaluator`).
- **PR scope:** one task (or less) per PR. If a diff wants to do two things, it's two PRs.
- **PR description:** the task's exit-criteria checklist, checked off, plus anything a reviewer needs to verify locally. For non-task PRs: what, why, and how it was tested.
- **Merge requirements:** CI green (no skips); a Changeset for any change to a publishable package (patch/minor/major honestly chosen — snapshot formats and golden corpora are public contracts); progress ledger updated for task PRs; review approval per below. Squash-merge; the squash message follows the commit convention.
- **Review:** the reviewer (human, or a second agent session given only the task file + diff) verifies exit criteria, R1–R7, cut-line, and security standards — and never extends the work. Author responds to every comment (fix or reasoned pushback); style nits that aren't lint rules are suggestions, not blockers.
- **Never merge red; never leave `main` broken.** Incomplete work parks on its branch with a `HANDOFF.md` (state, next step, what's red).

## External contributions (post-launch)

- **Talk first for anything non-trivial:** open an issue before a PR; design-affecting proposals sketch an ADR (context, decision, consequences). Typo/docs/small-fix PRs are welcome directly.
- **Licensing:** MIT, inbound = outbound — submitting a PR licenses your contribution under MIT. Sign-off (`git commit -s`, DCO) required.
- **Security vulnerabilities:** never as public issues — use the private reporting channel in `SECURITY.md`.
- **Scope:** the roadmap is demand-ordered (`ROADMAP.md`); PRs implementing deferred features unprompted will likely be declined with thanks — open the issue and make the demand case instead.
- **Conduct:** be kind, assume good faith, argue about code not people. Maintainers may close disrespectful threads.

## Quick pre-PR checklist

`pnpm build && pnpm typecheck && pnpm test && pnpm lint` green at root · exit criteria checked · tests ship with the change · docs named by the task updated · Changeset added if packages changed · ledger updated · no unexplained `as`/`any`/`eslint-disable` · no new dependency without justification.
