# Contributing to QCMS

**Status:** v1.0 · applies to human and agent contributors alike · committed to the repo root at bootstrap (task 001)
**Companions:** `PROJECT_INSTRUCTIONS.md` (read first) · `AGENTIC_DEVELOPMENT.md` §3 (session protocol) · `SECURITY_DESIGN.md` · `apps/api/CONTRIBUTING.md` (slice-level conventions, task 017)

## Ground rules

The reference documents in `docs/` are authoritative; the discipline rules R1–R8 and decisions ADR-01…37 / SEC-1…13 are not relitigated in PRs - a PR that violates them is not mergeable regardless of quality. Conflicts with a decision are raised as an issue proposing a new ADR, never resolved silently in code. The launch cut-line (R7) applies to contributions: out-of-scope features become `phase-4` issues, not PRs.

## Development environment

**The dev container is the recommended path (ADR-29).** It is the canonical, tested environment: one preinstalled Ubuntu 24.04 box with Node 24, pnpm (from the `packageManager` pin), Docker access, the GitHub CLI, Playwright's Chromium, and a configured zsh. Running the host toolchain directly still works and is fully supported; the container just removes the "works on my machine" class of problem. **On Windows, the container is the supported path** (Docker Desktop or Codespaces) rather than a native-PowerShell checkout.

**Prerequisites:** Docker (Docker Desktop, or Docker Engine under WSL2/Linux) and either the VS Code **Dev Containers** extension or the `@devcontainers/cli`.

```sh
# VS Code: open the repo, then "Reopen in Container".
# CLI (no editor needed):
pnpm devcontainer up   # wraps @devcontainers/cli; `pnpm devcontainer --help` for the rest
pnpm devcontainer run 'pnpm build'
```

GitHub **Codespaces** works from the same file: use the badge in `README.md`, or *Code → Codespaces → Create codespace*.

First start pulls the base image and runs `.devcontainer/post-create.sh` (corepack + `pnpm install --frozen-lockfile` + `playwright install --with-deps chromium`), so budget several minutes; later starts are quick.

**Full operational guide: [`docs/DEV_CONTAINER.md`](docs/DEV_CONTAINER.md)** - every command, what the container
takes over from your machine (ports, `node_modules`, the Docker daemon), running the app, troubleshooting, secrets,
Codespaces, and rollback. That file is the single source of truth for using the container; this section only frames it.

Two things worth knowing before your first run: **only one qcms dev container runs at a time** (it publishes fixed host
ports), and **`devcontainer up` silently reuses a running container**, ignoring changed `runArgs`/`appPort`/`containerEnv` -
use `pnpm devcontainer rebuild` after editing `devcontainer.json`.

**Rollback** is a one-liner: the container changes no product code, so deleting `.devcontainer/` (or simply never opening the repo in a container) leaves every host workflow unchanged. Details, including the one `pnpm install` you need if that checkout had been used in the container, are in [`docs/DEV_CONTAINER.md`](docs/DEV_CONTAINER.md#rollback).

## Coding standards

### TypeScript

- Strict mode everywhere (`tsconfig.base.json` is not weakened per-package).
- **Domain types are inferred from Zod schemas** (`z.infer`) - never hand-written in parallel. One schema, one type, one place.
- No `any`. `unknown` at trust boundaries, narrowed by parsing (Zod), not by `as`. Every `as` cast and every `eslint-disable` needs a one-line justification comment; unexplained ones fail review.
- Exported functions declare explicit return types (inference is fine internally).
- Discriminated unions + exhaustive `switch` with a `never` check - adding a variant must break the build until handled.
- Expected failures return typed results (`Result`/`ok|err` with coded errors, all-errors-not-first in validators); exceptions are for bugs only and never cross a package boundary as control flow.

### Style and structure

- **Functional core:** `packages/*` are pure functions over immutable data - no classes for domain logic, no internal state, no I/O in `core`/`a2ui-compiler` (R3/R4). Dependencies are explicit parameters; no DI container, no service locator (.NET mapping: think static pure methods + explicit `deps` records, not `IServiceCollection`).
- Naming: files kebab-case; types/schemas PascalCase (schema and inferred type share a name); functions/variables camelCase; module-level constants SCREAMING_SNAKE only when truly global (`SEMANTICS_VERSION`).
- Imports: packages expose a public API via their index; no deep imports across package boundaries; no circular dependencies (enforced by lint); `apps/*` never import each other.
- Lint rules live in the **root flat config** (`eslint.config.js`); per-package additions only for package-specific import-surface rules (e.g. core's no-db-import). Formatting is owned by Prettier and never discussed in review. Lint rules are the standard - if a convention matters, encode it as a rule or import-surface test, don't police it by hand.
- **Static analysis (issue #14):** `eslint-plugin-sonarjs` runs inside lint (bugs, code smells, cognitive complexity); its project tuning is documented inline in `eslint.config.js` (each disable carries a rationale, e.g. the kernel's essential-complexity algorithms). Copy-paste detection is `pnpm check:duplication` (jscpd, `.jscpd.json`, 3% threshold) - it accepts the deliberate vertical-slice repetition (R5) and fails only on a real regression. Both run in CI.
- Comments explain *why*, not *what*. JSDoc on exported package APIs. Every `TODO` references an issue number; free-floating TODOs fail review.
- **No em dash (Unicode U+2014), anywhere** - prose, comments, commit messages, or UI strings. It reads as an AI-generated tell and QCMS is public. Use a colon, comma, parentheses, a period, or a spaced hyphen (` - `) instead. The en dash (`–`) is fine for numeric ranges (`R1–R8`); the hyphen (`-`) is always fine. Enforced by the `check:no-em-dash` gate in CI.

### Dependencies (mirrors `a2-react-aria`'s approval policy)

- **Approval thresholds - before adding (or even suggesting) any package or tool, verify it meets one:**

| Criteria | Threshold |
| --- | --- |
| **Official** | Maintained by the primary org behind the tool (Adobe for React Aria, Microsoft for Playwright, …) |
| **Popular npm package** | ≥ 5,000 GitHub stars and/or ≥ 500,000 weekly npm downloads |
| **Explicitly approved** | Reviewed by the owner and recorded in the approved list below |

  Do not assume popularity - check stars/downloads. Below every threshold: stop, state the concern, and ask before proceeding.
- **Runtime dependencies carry a risk assessment in their PR:** maintenance health (bus factor, release cadence), governance (who funds it; paid-pivot risk), and the exit path if it is abandoned or rug-pulled. Dev/test-only dependencies need only the threshold check.
- **License compatibility (enforced):** every **runtime** dependency must carry a permissive, MIT-compatible license (MIT, ISC, BSD, Apache-2.0, 0BSD, …). Copyleft (GPL/AGPL/LGPL/SSPL/EUPL), source-available (BUSL/Elastic), and unlicensed/proprietary licenses are forbidden in the runtime tree - QCMS is MIT and redistributed. The `check:licenses` gate (deny-by-default over `pnpm licenses --prod`) fails CI on anything not allow-listed; dev-only deps are exempt (not redistributed).
- **Minimal-dependency policy stands:** prefer the platform (WebCrypto over a JWT library - task 010 is the reference pattern). A dependency that saves under a hundred lines is a liability, not a convenience.
- **Accepted-with-noted-risk list** (deliberate acceptances; the watch items of risk register #5):

| Package | Risk noted | Why accepted / exit path |
| --- | --- | --- |
| `better-auth` | Young, VC-funded; auth-cloud pivot is the classic risk shape | Narrow scope used (email+password, TOTP, sessions); all data in our own Postgres; swap recipe `docs/auth-swap.md` (031) |
| `drizzle-orm` | Young, VC-funded | No magic used - migrations are plain SQL files, helpers are thin; exit to Kysely/raw SQL is bounded |
| `ai` (Vercel AI SDK) + `@ai-sdk/*` | Vercel-owned - same steering/churn profile as Next/Turborepo | Vendor-agnostic LLM layer for 041 only; confined behind the `DraftAssistant` seam, so a swap touches one adapter file |

### Security overrides (`overrides` in `pnpm-workspace.yaml`)

Transitive advisories that a parent's pinned range blocks are patched with **targeted** overrides, not by waiting on Dependabot (its `npm_and_yarn` updater fails on multi-range advisories in a pnpm monorepo - issue #47). pnpm 11 reads `overrides` **only** from `pnpm-workspace.yaml`; a `pnpm.overrides` block in the root `package.json` is silently ignored (issue #383). Rules for adding one:

- **Establish that an override is needed at all, by refreshing the lockfile first.** Dependabot reports `security_update_not_possible` whenever *it* cannot construct the update, which includes the case where the parent's declared range already admits the patched version and only the lockfile is behind. `pnpm update -r --depth Infinity <package>` followed by `pnpm why -r <package>` settles which case you are in. An override added for the stale-lockfile case fixes nothing that a refresh would not, and it has no reachable removal condition (issue #332).
- **Scope it to the vulnerable resolution** (`"minimatch@9": "^10.2.5"`), never a bare package name, unless every consumer in the tree is already on that major. A blanket override silently forces future consumers of an older major onto an incompatible API.
- **A caret override does not deduplicate, and its floor has to be re-checked when a follow-up advisory lands.** Two distinct failures, both found in #444. (1) *Staleness:* any two versions satisfying the range can coexist, because pnpm keeps an existing satisfying resolution rather than re-resolving to the newest, so one parent sat on `postcss@8.5.23` (with the vulnerable `nanoid@3.3.16`) while another had `8.5.26`. The override never converges the tree on its own: `pnpm update -r --depth Infinity <package>` does, and `pnpm why -r <package>` must end in `Found 1 version`. (2) *A lapsed floor:* `brace-expansion@5: ^5.0.8` still admitted `5.0.8`, which a later bypass advisory (GHSA-rgw5 against GHSA-mh99) made vulnerable, so the entry permitted exactly what it existed to exclude. Verify from the lockfile that the bad version is absent, not from a quiet `pnpm audit`.
- **Verify the API contract by hand before trusting the install.** `pnpm install` succeeding proves nothing about a major-crossing override: read how the dependents actually import the package (`require(...)` default vs named) and check the new version still satisfies it.
- **Prove it with the gates that exercise the affected path**, not just `pnpm audit`: postcss means a real portal build plus the Playwright suite; the testcontainers chain means a forced `turbo run test --force`; drizzle-kit means `drizzle-kit check`.
- **Record why it exists and when it can go**, in the table below. An override with no removal condition becomes permanent by accident.

| Override | Advisory it closes | Why this version | Removable when |
| --- | --- | --- | --- |
| `postcss: ^8.5.23` | GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849 | The three advisories need at least `8.5.18` (the highest of their patched floors: 8.5.10, 8.5.12, 8.5.18). Next pins `postcss` **exactly** (`8.4.31` when this row was written, `8.5.23` as of next 16.3.0), so a parent bump can never share whatever version the rest of the tree resolves. Left unscoped so it reaches every consumer. **The range alone does not deduplicate**: `8.5.23` and `8.5.26` both satisfy `^8.5.23`, so pnpm keeps a stale resolution beside a fresh one until the lockfile is refreshed, which is how #444 got a second postcss dragging `nanoid@3.3.16` | Next stops pinning `postcss` exactly, so its own resolution can converge with vite's |
| `minimatch@5: ^10.2.5` · `minimatch@9: ^10.2.5` | GHSA-mh99-v99m-4gvg (indirectly) | minimatch 5 and 9 pin `brace-expansion@^2` (`^2.0.1` and `^2.0.2`). When this was added the fix existed only in `brace-expansion` 5.0.8, so the vulnerable copy had to move *with* minimatch rather than under it: `minimatch@10.2.5` declares `brace-expansion: ^5.0.5`. Safe because every dependent (`glob@10`, `readdir-glob@1`) imports minimatch by **named** export, which 10 keeps. **That premise has since lapsed**: both advisories are now backported to the `^2` line (2.1.4), so a `brace-expansion@2` override would close them without crossing a minimatch major | `archiver`/`testcontainers` reach minimatch 10 on their own, or the pair is replaced by a `brace-expansion@2: ^2.1.4` override (needs its own check that nothing depends on minimatch 10 behaviour by then) |
| `brace-expansion@5: ^5.0.9` | GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 | Two advisories stack here, and the second bypasses the first one's mitigation, so the floor is the later of the two: GHSA-mh99 patches 5.x at `5.0.8` (vulnerable `>= 4.0.0, < 5.0.8`), GHSA-rgw5 patches it at `5.0.9` (vulnerable `>= 4.0.0, < 5.0.9`). Both are fixed on every live line (1.1.18, 2.1.4, 3.0.6, 5.0.9), so this is not the "no backport exists" case: the scoping to `5` is a compatibility choice, keeping a future `^2` consumer off 5.x, whose CJS build exports `{ expand }` and is **not** callable. The floor must sit *above* the vulnerable versions, not merely admit the patched one: `^5.0.8` let `5.0.8` back in (#444) | minimatch's own floor reaches 5.0.9 |
| `esbuild@0.18.20: ^0.25.12` | GHSA-67mh-4wv8-2f99 | Pins only the vestigial copy under drizzle-kit's deprecated `@esbuild-kit/*` chain; drizzle-kit already resolves `esbuild@0.25.12` directly, so this dedupes rather than adding a version | drizzle-kit drops `@esbuild-kit/esm-loader` |

### Testing

- **Two runners, fixed (ADR-23):** Vitest for everything below the browser (unit, component, API slices/scenarios); **Playwright is the only browser/e2e framework** - specs live in `apps/{portal,admin}/e2e/`. No other test frameworks, ever.
- Tests co-located (`foo.test.ts` beside `foo.ts`); names state behavior ("rejects backward rule targets"), not method names.
- Right tool per layer: property tests (fast-check) for pure logic; golden files for frozen semantics (change = version bump, never a quiet regen); testing-library + axe for components (the renderer conformance suite is the component layer); `app.request()` for API slices; Testcontainers for storage; Playwright for browser flows.
- **Every feature lands with e2e coverage at the highest layer that exists for it, in the same PR (ADR-23):** kernel/db/API features extend the HTTP scenario suite (027-style); anything with a browser surface ships a passing Playwright spec. A feature without its e2e test is not done, regardless of unit coverage.
- Don't mock our own packages - slices test against the real kernel; mocks are for genuine externals (HTTP receivers, clocks).
- Coverage: `@qcms/core` effectively total (≥95% lines, exclusions justified in code); elsewhere, every exit criterion and every bug fix has a test. A bug fix without a regression test is incomplete.

### Security (binding, from SECURITY_DESIGN)

No secrets in code, fixtures, or logs; answer values never logged; queries parameterized via Drizzle only (no SQL string interpolation); WebCrypto, never `node:crypto`, in fetch-pure code; no CORS headers, ever; new dependencies follow the Dependencies policy above (thresholds + risk assessment in the PR).

## The merge gate: `pnpm verify`

**One command, and it is a superset of CI** (issue #19). Work used to pass a four-command local gate, land, and then go CI-red on a gate that only CI ran (task 029 shipped an LGPL transitive dependency exactly that way), so the local gate now runs every check CI runs:

```sh
pnpm verify           # the landing gate: check:all, then build, typecheck, lint, test, golden-drift
QCMS_PORT_SEAT=0 pnpm verify:browser   # the Playwright suite (portal e2e + a11y + Lighthouse), see below
```

| `.github/workflows/ci.yml` step | Covered by |
| --- | --- |
| `pnpm build` (both occurrences) | `pnpm build` |
| `pnpm typecheck` | `pnpm typecheck` |
| `pnpm lint` | `pnpm lint` (turbo eslint + `prettier --check .` + `check:fixture-domain`) |
| `pnpm test` | `pnpm test` (turbo test incl. the api e2e project, + `test:tooling`) |
| `pnpm test:golden-drift` | `pnpm test:golden-drift` |
| `pnpm check:golden-append-only` | `pnpm check:all` |
| `pnpm check:changeset` | `pnpm check:all` |
| `pnpm check:no-control-chars` | `pnpm check:all` |
| `pnpm check:licenses` | `pnpm check:all` |
| `pnpm check:no-em-dash` | `pnpm check:all` |
| `pnpm check:ports` | `pnpm check:all` |
| `pnpm check:security-hygiene` | `pnpm check:all` |
| `pnpm check:duplication` | `pnpm check:all` |
| `pnpm check:admin-theme` | `pnpm check:all` |
| `pnpm check:lint-coverage` | `pnpm check:all` |
| `api-e2e` job (`--project qcms-api-e2e`) | `pnpm test` (apps/api's `test` script runs that project) |
| `portal-e2e` job (`playwright test`) | **`pnpm verify:browser`** - deliberately not in `verify` |
| `full-stack-e2e` job in `e2e.yml` (`pnpm docker:up` + `pnpm test:e2e`) | **`QCMS_PORT_SEAT=<0-9> pnpm up:e2e`** - deliberately not in `verify` or `verify:browser`, see below |
| `codeql.yml`, `mirror-test-images.yml` | Not local gates (GitHub-hosted analysis / image mirroring) |

`check:changeset` is new with this gate: it enforces the "Changeset for any change to a publishable package" merge requirement (issue #55, folded into #19), locally and in CI.

### The `plan/**` fast lane (`check:plan`)

A pull request whose **every** changed path is under `plan/` takes a short path through CI. `plan/` is the committed planning and design area, not a pnpm workspace: nothing under `apps/` or `packages/` imports it, `.prettierignore` lists it, jscpd only scans `packages apps`, and `check:no-em-dash`, `check:ports` and `check:lint-coverage` each exclude it with a `:!plan/**` pathspec. Build, typecheck, lint, the unit suites and all three end-to-end suites therefore cannot see a prose-only change, and running them cost roughly 20 minutes per run (PR #524 paid it twice on one head).

Three gates **do** read `plan/**`, and `pnpm check:plan` is exactly those three:

| Gate | Why `plan/**` is in its scope |
| --- | --- |
| `check:no-control-chars` | `git ls-files` over its `SOURCE_GLOBS` (`*.ts`, `*.tsx`, `*.mjs`, `*.mts`, `*.js`, `*.jsx`, `*.json`, `*.md`) with no `plan/` exclusion. |
| `check:security-hygiene` | Its example-env scan is `git ls-files -- *.example **/*.example`, repo-wide. |
| `check:admin-theme` | `plan/admin-theme/tokens.css` is the **source** it compares `apps/admin/app/theme.css` against, so a plan-only edit to the token sheet has to go red. |

**If you add a gate that reads `plan/**`, add it to `check:plan`.** Same trap as issue #463 one level down: a gate that only reaches `check:all` is a gate a plan-only PR never runs.

Two properties of the lane are load-bearing and should not be "simplified" away:

- **The four required contexts always run and always report.** `protect-main` requires `verify (node-24)`, `api-e2e`, `portal-e2e` and `full-stack-e2e`, and has no bypass actors. The fast lane guards individual **steps**, never the jobs, because a required context that reports nothing leaves the PR at "Expected - waiting for status" with no way forward, and a context reported as `skipped` counts as satisfied - which would be worse still.
- **Every uncertain case runs the full suite.** `scripts/ci-plan-only.mjs` answers `false` for a non-`pull_request` event, an empty diff, an unresolvable base ref, and any error; the required jobs carry `if: ${{ !cancelled() }}` so a broken classifier cannot skip them into a false green. Renames are read with `--no-renames`, so a file moved out of `plan/` counts as code, and paths are read NUL-separated and never trimmed, so a committed path with a leading space (` plan/evil.ts`) stays outside `plan/`.
- **The classifier is read from the PR's base ref, not from the PR.** The `changes` job runs `git show "origin/$GITHUB_BASE_REF:scripts/ci-plan-only.mjs"`. A checked-out copy would let a pull request that breaks the classifier certify its own diff as prose and skip the very test suite that would have caught it. Practical consequence: **any PR that touches `scripts/ci-plan-only.mjs` gets a full run**, and so did the PR that introduced it.

One change to how a pushed branch behaves comes with this: **`ci.yml` and `e2e.yml` now trigger on `push` only for `main`**, so a branch pushed with no pull request open gets no CI at all. The claim-lock branch (`feat/NNN-*`, `fix/NN-*`) still claims the task the moment it is pushed, but it produces no checks until its PR exists. Open the PR to get a verdict; `gh pr checks <N>` is the way to read one, and `gh run list --commit <sha>` on a bare branch will now legitimately come back empty.

**`check:admin-theme` in one paragraph** (task 055). Three properties of the QCMS app's own styling, none of which a diff shows once the app grows: every colour in `apps/admin` outside `apps/admin/app/theme.css` is a `var(--...)` reference (a raw hex or a Tailwind palette utility looks right in whichever mode the author had open and is wrong in the other two); the landed sheet is byte-identical to `plan/admin-theme/tokens.css`, which is generated behind a WCAG contrast gate, so a hand-edit cannot keep the published contrast table while losing the property it certifies; and no value in the app's message catalog names the app "admin" (the product is QCMS and the respondent app is the Portal - code identifiers such as `apps/admin` and `qcms-admin` are deliberately untouched). Comments are excluded from both scans, so a comment citing `issue #177` or describing the app by its directory is fine.

**`check:security-hygiene` in one paragraph** (task 040). Three static properties the runtime controls cannot establish about themselves. **Answer content is never passed to a logger**: the stdout logger redacts by field name and the OTLP path is an allowlist, so a value logged under a key nobody anticipated still reaches an operator's aggregator, and SEC-8 states the rule at the call site ("log questionIds and counts, not content"). **No committed `.env*.example` carries a live-looking secret**, which is the mirror of the boot-time refusal in `apps/api/src/config.ts`: the config guard stops a placeholder reaching production, this gate stops a real secret reaching the repository, and **the two placeholder lists must stay aligned or a spelling one accepts and the other rejects reopens the gap**. **No SQL reaches the driver unparameterized by the forms a regex can see**: Drizzle's `sql` tagged template binds its interpolations; `sql.raw()` does not, a bare interpolated template literal handed to `execute`/`query` does not, and neither does `+` concatenation adjacent to a quoted literal (all three quote characters, backtick included) in the first argument of `execute`/`query`. It cannot see a statement assembled elsewhere and passed by variable, which needs data-flow analysis; the module comment enumerates the boundary and a test pins it. One line is waived with a `check-security-hygiene: allow <reason>` comment directly above it, so the reason sits in the diff where a reviewer sees it. **Adding a gate to `check:all` does not put it in CI**: `.github/workflows/ci.yml` enumerates every check as its own step, and three changes in one day (PR #451, the fix for issue #413, and this task) shipped a gate that ran locally and never in CI (issue #463). The gate's self-tests run under the `tooling` vitest project; the repository scan is the workflow step.

**`check:lint-coverage` in one paragraph** (issue #413). ESLint only ever reads the paths a `lint` script hands it, and until this gate nothing checked that those paths add up to the tree. A file outside every one of them was not a red and not a warning: `pnpm lint` simply reported green over a file it never opened, which is the one failure mode a gate cannot be trusted through. The repo hit it three times (root `scripts/` in #257, `apps/admin`'s omitted `instrumentation.ts` in #387 item 21, and both apps' hand-written file lists in #413), each surviving until somebody happened to read a command echo. So: every tracked source file (`git ls-files`, never a directory walk, which would include build output) must sit inside some package's `lint` scope, where scope is parsed out of the `lint` script itself so the gate cannot drift from the command it describes. Anything genuinely outside is listed in `KNOWN_UNLINTED` in `scripts/check-lint-coverage.mjs` with its reason and where that decision is recorded, and **an entry matching nothing fails the gate**, so the inventory shrinks as coverage grows rather than outliving the gap. A stale lint target (a path the script names that no longer exists) fails too. **When it fires, widen a `lint` script to a directory or `eslint .`; do not add the file by name.** A hand-written list is the defect the gate exists to catch, and an `eslint-disable` is the same defect wearing a different hat.

**Why the browser suite is separate.** `verify` is minutes long already; adding a browser boot, Docker Postgres, and two Lighthouse runs to *every* iteration is how a gate gets routed around. Run `QCMS_PORT_SEAT=<0-9> pnpm verify:browser` before landing anything that touches `apps/portal`, `apps/admin`, or `@qcms/ui` - and note it is the only part of CI a green `verify` does not vouch for. **Budget 10-15 minutes** (measured: 10.2 min, 176 passed / 30 skipped / 0 failed), not the one-to-two an earlier version of this section implied - issue #299. The seat is **not optional from a linked worktree**, which is where every agent lane works: the harness refuses an unset seat there rather than silently adopting another lane's dev servers and reporting green for a tree it never loaded (R8, `docs/PORTS.md`, issue #255). `0` is the right answer whenever nothing else is running.

**The browser suite leaves build output behind, so a green is a property of the tree *and* of what ran before it** (issue #629). `verify:browser`, `pnpm dev:admin` and `pnpm dev:portal` all boot a dev server, which writes `apps/<app>/.next-dev`; a production build writes `apps/<app>/.next`; both leave `next-env.d.ts` and a generated `AGENTS.md` and `CLAUDE.md` beside them. All of it is git-ignored, none of it is cleaned up, and a gate that reads the filesystem by walking directories reads it as source. That is how `apps/admin/app/(shell)/table-anchors.test.tsx` came to fail in every checkout that had run the browser suite and pass on CI, which has no prior dev build: two lanes on the same commit, both results repeatable, both honest, opposite. Two consequences. **Meeting an unexplained red, check what a previous gate left before you suspect your diff** - `git status --ignored apps/admin` and a run from a fresh worktree separate the two in a minute, and note that CI being green is not evidence here, because CI is green precisely for lacking the state that reveals it. **Writing a filesystem-scanning gate, enumerate with `git ls-files`, never a directory walk** (`--cached --others --exclude-standard` when files added but not yet staged should count). `.gitignore` is the repository's one maintained catalogue of what is generated rather than authored; a skip list inside a test is a second copy that only ever lags, and this one had `.next` in it while the dev server had been building into `.next-dev` since issue #54.

**When a rebase moves the lockfile, whether that forces a browser re-run is decidable, so decide it rather than guessing.** The rule (derived on PR #477, 2026-08-14): a rebase or merge that changes `pnpm-lock.yaml` forces `verify:browser` **if and only if** the resolution change reaches a package in either app's **build or runtime closure**. `postcss`, `tailwindcss`, `next`, `react` and `@a2ra/*` are inside it; a dev-only tooling dependency outside the apps' graphs is not. **`pnpm --filter qcms-portal why <pkg>` (or `--filter qcms-admin`) answers which side of the line a given bump is on**, so the question has an answer rather than a worry. Use the filtered form, not a bare `pnpm why` at the workspace root: the root answers a cross-workspace question and will happily show a package that reaches some other workspace member and neither app. Read the output for whether the app itself appears as a consumer, under `dependencies` or `devDependencies` either way, since a build-time dependency that shapes CSS is exactly the case this rule exists for.

That distinction is worth stating because both errors are expensive in different ways. Re-running the suite for every lockfile move burns 10 to 15 minutes on changes that provably cannot affect a rendered page, which is how a gate gets routed around. Skipping it after a `postcss` or `tailwindcss` bump is the failure that unit tests structurally cannot catch, because a CSS pipeline change renders wrongly while every assertion below the browser still passes.

**Carrying a verification across a rebase needs a claim about the code, not about git.** "The rebase was clean" says the merge succeeded. What licenses reusing an earlier green is a **diff-of-diffs**: compare `(old-base..old-head)` against `(new-base..new-head)` over the paths the verification covered, and confirm it is empty. That is a claim the content is unchanged, and it is the only one strong enough to carry a security or browser verification forward without re-running it.


**Why the full-stack smoke run is separate too** (task 036). `full-stack-e2e` builds the three application images and boots the solo Docker Compose topology (`docker-compose.yml`), then drives one authoring-to-respondent flow through it: it proves the shipped containers, the one-shot migration and the published ports work together, which no other job covers. It is minutes of image building, so it stays out of `verify` and out of `verify:browser`; run it locally with `QCMS_PORT_SEAT=<0-9> pnpm up:e2e` (self-contained: up, suite, teardown) when you change a Dockerfile, `docker-compose.yml`, or anything either app reads from the environment at boot. It takes this seat's **harness** ports and its own Compose project, so it never disturbs `pnpm dev:portal` (stable block) - but it shares the harness block with `verify:browser`, so do not run those two at the same seat.

**The seat is not optional here either, and for a sharper reason** (issue #296). The seat selects this stack's Compose **project name**, and teardown runs `docker compose down --volumes --remove-orphans` under it. A run that silently fell back to seat 0 would not merely read another lane's stack, it would delete it. So a linked worktree with no `QCMS_PORT_SEAT` is refused at startup, before anything is spawned, exactly as `verify:browser` is refused; the primary checkout and CI keep the silent default.

**It runs from the dev container as of issue #316, and did not before.** The stack publishes on the Docker host's loopback, and inside the dev container that host is another machine (`docker compose` drives the mounted host socket, ADR-29), so no sibling container can reach it at any address. The suite died in `beforeAll` with `ECONNREFUSED` while every container reported healthy, and `pnpm up:e2e` was effectively CI-only from the canonical environment.

The fix keeps the browsed origin on `http://localhost:<port>` in **every** environment and makes that address real inside the container, by joining the Compose network and forwarding this container's loopback to the service containers (`scripts/loopback-forward.mjs`). That shape is deliberate and worth knowing before you change anything near it: browsing the host gateway instead would drop the admin's `Secure` cookies (browsers trust `http://localhost`, not a bare IPv4), and the only way to make *that* work is to turn `Secure` off locally, which would have the local run exercise a different cookie configuration than CI and stop covering the auth boundary this suite exists for. **So the invariant is: the local full-stack run must exercise the same configuration as CI.** `composeEnvironmentOverrides` takes no environment input at all, and three tests pin that it never sets `QCMS_ADMIN_SECURE_COOKIES` or `QCMS_BIND_ADDRESS`. On a plain host checkout and on CI none of the container machinery is built: `localhost` already works there.

**When a change earns full-stack coverage** (`apps/e2e/`). The cheap suites come first. A behaviour that lives inside one app belongs in that app's own suite, where it runs in seconds against a locally composed API; reach for `apps/e2e/` only when the scenario cannot be true in a single app, or cannot be true outside the shipped containers.

Two shapes earn it. The first is a feature that crosses an app boundary end to end: authored in the admin, published, then completed by a respondent in the portal. Nothing per-app fails when that handoff breaks, because each half still passes in isolation, so the crossing is only ever observed here. The second is anything that depends on what the containers do rather than on what the code does: migrations running as their own step before the API starts, configuration read at container boot rather than at module load, the published ports and the public origin that redirects and secure links are built from, and auth crossing a service boundary. Those are properties of the images and the Compose topology, and a suite that imports the app in-process cannot see them at all.

Everything else stays out. Single-app UI and a single API slice are already covered, far more cheaply, by `portal-e2e` (portal plus the admin Playwright project) or by the `api-e2e` scenario suite. The full-stack job builds three application images on every run, so its cost per test is high and what it buys is integration, not coverage: a case added here for coverage's sake slows the whole set down without making any new failure visible. If you can describe the regression you are guarding against without naming a container, an image, or a second app, it belongs in a cheaper suite.

Run it locally before you push a change of that shape: `QCMS_PORT_SEAT=<0-9> pnpm up:e2e` is self-contained (up, suite, teardown), and `QCMS_PORT_SEAT=<0-9> pnpm up:e2e:headed` does the same with the browser visible. It takes this seat's **harness** ports, the same block `verify:browser` uses, so those two must never run at the same seat - use a second seat digit or run them one after the other.

**`check:changeset` in one paragraph.** It fails when the diff against `origin/main` touches a publishable package with no changeset **added in the same diff** naming that package (an unreleased changeset already on `main` does not count). The publishable set is derived from each `package.json`'s `private` field plus `.changeset/config.json`'s `ignore`, so it never goes stale. Exempt: markdown anywhere (docs, package READMEs, CHANGELOGs), private packages (`apps/*`), and test files/directories inside a publishable package (`*.test.ts`, `*.e2e.ts`, `e2e/`, `__tests__/`, `test/`) - a test-only change alters nothing a consumer can call, and a changeset that is not required is still allowed. `packages/db/src/testing/` is **not** exempt: it is the published `@qcms/db/testing` subpath. A `changeset version` release diff (which deletes changesets) is passed through, so the release PR is never blocked by the gate it spends. It reads committed state, so commit before you trust its verdict.

## Git and PR rules

- **Branches:** `feat/NNN-slug` for plan tasks (NNN = the ledger task number), **`fix/NN-slug` for a GitHub issue fix** (NN = the issue number - the `/next-issue` flow treats a live `fix/NN-*` branch as the claim on issue NN, so the number is load-bearing, not decoration), `docs/slug`, `chore/slug` otherwise. Task numbers and issue numbers share a numeric space, which is exactly why the prefixes differ: `feat/` is reserved for ledger tasks. Never force-push `main`; force-push your own branch freely before review.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`); include the task number for plan work (`feat(core): 006 forward-pass evaluator`).
- **PR scope:** one task (or less) per PR. If a diff wants to do two things, it's two PRs.
- **PR description:** the task's exit-criteria checklist, checked off, plus anything a reviewer needs to verify locally. For non-task PRs: what, why, and how it was tested.
- **Merge requirements:** CI green (no skips); `pnpm verify` green locally *after* the final rebase; a Changeset for any change to a publishable package (enforced by `check:changeset`) (patch/minor/major honestly chosen - snapshot formats and golden corpora are public contracts); progress ledger updated for task PRs; review approval per below. Squash-merge; the squash message follows the commit convention.
- **Review:** the reviewer (human, or a second agent session given only the task file + diff) verifies exit criteria, R1–R8, cut-line, and security standards - and never extends the work. Author responds to every comment (fix or reasoned pushback); style nits that aren't lint rules are suggestions, not blockers.
- **Never merge red; never leave `main` broken.** Incomplete work parks on its branch with a `HANDOFF.md` (state, next step, what's red).

## External contributions

> **Not accepting external pull requests yet.** QCMS is pre-release and built through an agentic workflow by the maintainers; **external** (unsolicited) PRs will be declined for now. **Issues, bug reports, and discussion are welcome** - and are the most useful thing you can contribute at this stage. Security reports go through [`SECURITY.md`](SECURITY.md), never a public issue. The rules below apply once external PRs open (post-launch).

- **Talk first for anything non-trivial:** open an issue before a PR; design-affecting proposals sketch an ADR (context, decision, consequences). Typo/docs/small-fix PRs are welcome directly.
- **Licensing:** MIT, inbound = outbound - submitting a PR licenses your contribution under MIT. Sign-off (`git commit -s`, DCO) required.
- **Security vulnerabilities:** never as public issues - use the private reporting channel in `SECURITY.md`.
- **Scope:** the roadmap is demand-ordered and post-launch work is never pre-built; the launch cut-line is `docs/PROJECT_GOAL.md` §5 (deferred items are tracked as `phase-4` issues). PRs implementing deferred features unprompted will likely be declined with thanks - open the issue and make the demand case instead.
- **Conduct:** be kind, assume good faith, argue about code not people. Maintainers may close disrespectful threads.

## Quick pre-PR checklist

`pnpm verify` green at root (plus `pnpm verify:browser` if the change touches the portal, admin, or `@qcms/ui`) · exit criteria checked · tests ship with the change · docs named by the task updated · Changeset added if packages changed (`check:changeset` enforces it) · ledger updated · no unexplained `as`/`any`/`eslint-disable` · no new dependency without justification.
