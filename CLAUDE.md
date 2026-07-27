# QCMS - Claude Code guide

**QCMS** is an MIT-licensed TypeScript engine for questionnaires with deeply conditional logic, distributed shadcn-style (owned scaffolded shell + versioned `@qcms/*` packages).

**Read first, every session: `PROJECT_INSTRUCTIONS.md`** - the binding rules (R1–R7), decisions (ADR-01…25, SEC-1…12), and session protocol. This file adds only harness wiring; where they overlap, PROJECT_INSTRUCTIONS wins.

**Roles:** sessions in this checkout are **implementation** sessions (this file governs them). The product-owner role exists separately, seated outside this checkout - its charter is `docs/PRODUCT_OWNER.md`. Never assume the PO role in a session here.

## Naming (settled)

**Brand:** the product is **QCMS**. Use "QCMS" in prose, titles, and UI. "Question CMS" is the expansion - write it at most once per document as a first-use gloss (`QCMS (Question CMS)`), never as the running name. Lowercase `qcms` is only the repo/dir/package-scope identifier.

**No em dash (Unicode U+2014), anywhere:** prose, comments, commit messages, UI strings. It reads as an AI tell and the repo is public. Use a colon, comma, parentheses, a period, or a spaced hyphen (` - `). The en dash (`–`) is allowed for numeric ranges only. The `check:no-em-dash` gate (`pnpm check:no-em-dash`) enforces this in CI.

**No personal names in committed content (2026-07-25):** the human owner is referred to as **Code Owner** in all prose, docs, comments, sign-off records, and commit messages - never by name. Sole exception: the legal copyright attribution in `LICENSE` and the README license line, which keep a legal name the Code Owner chooses. (Git author metadata on past commits is history and stays; this rule governs file contents going forward.)

**No machine-specific paths in committed content (2026-07-25):** anyone can clone the repo into any parent folder, so committed files never assume one - no `/home/<user>`, no drive letters, no named parent directories. Use repo-root-relative paths (`scripts/agent-loop.sh`), `~` for home when unavoidable, and "sibling checkout `../a2-react-aria`" phrasing for the component library.

| Thing | Name |
|---|---|
| Repo / product | **QCMS** (dir/scope: `qcms`, `@qcms/*`) |
| Publishable packages | `@qcms/core` · `@qcms/a2ui-compiler` · `@qcms/db` · `@qcms/ui` |
| Apps (private) | `qcms-api` · `qcms-portal` · `qcms-admin` |
| Scaffolding CLI | `create-qcms-app` |
| Env prefix / flag prefix | `QCMS_` / `QCMS_FLAG_` |
| ID prefixes | `q_ frm_ stp_ opt_ rul_ ses_ lnk_` (branded, never reused - R6) |

npm: `@qcms/*`, `qcms`, and `create-qcms-app` were all unclaimed as of 2026-07-19; create the npm org before first publish (Stage 5).

## Toolchain - hard rules

- **The dev container is the canonical environment (ADR-29).** `.devcontainer/` (Ubuntu 24.04 + Node 24 + host Docker socket for Testcontainers) is where the loop runs, with `--permission-mode bypassPermissions` - the container is the blast radius. Launch path, dev-DB address, `TESTCONTAINERS_HOST_OVERRIDE` fallback, the host resources the container takes over, and rollback: `docs/DEVELOPER_GUIDE.md`. The canonical (and only) supervisor is `scripts/agent-loop.sh`; `agent-loop.ps1` is **retired** (ADR-29 amended 2026-07-25) and a Windows contributor's supported path is the container itself, via Docker Desktop or Codespaces. Cross-platform guards stay, but every note about PowerShell quoting/`$env` traps, `git.exe` vs `git`, `pnpm.cmd`, docker-credsStore, and leftover worktree folders describes **a Windows host only** - none of it applies inside the container.
- **pnpm only.** Never npm or yarn (the `packageManager` field pins it from 001). CI uses `--frozen-lockfile`. Registry/version queries: `pnpm view <pkg>` (bare `npm view` is denied by the pnpm-only permission rules).
- **Vitest below the browser, Playwright for e2e** (ADR-23). No other test frameworks, ever.
- **Adding or changing an input control follows `docs/COMPONENT_GUIDELINES.md`** - vendoring fidelity, registry/adapter contract, an explicit ADR-31 commit-moment row (never the silent default), conformance/keyboard/no-JS/focus coverage, token compliance, lint-glob membership.
- **Gate for every merge: `pnpm verify` green at root** (**green-or-clean** - never merge red; park unfinished work on its branch with a `HANDOFF.md`). `verify` = `check:all` (em dash, control chars, changeset, golden-append-only, licenses, duplication) then build, typecheck, lint, test, golden-drift - a superset of the CI unit job, so a local pass can no longer be CI-red (issue #19). The four-command `build && typecheck && test && lint` is now the *iteration* loop, not the landing gate. The browser suite is the one CI job `verify` leaves out: run `pnpm verify:browser` (Playwright, ~2 min) as well whenever the change touches `apps/portal`, `apps/admin`, or `@qcms/ui`. The changeset gate compares **committed** state against `origin/main`, so commit before you read its verdict.
- New dependencies follow `CONTRIBUTING.md`'s approval policy (thresholds + risk assessment in the PR).
- **DB/integration tests** use the Testcontainers harness in `@qcms/db` (exported at its `./testing` subpath - don't re-derive the Docker-credsStore workaround; import `withTestDb`). Force-run them (`--force`) - turbo cache replays logs without booting Postgres. DB-testing traps (all cost a live cycle to rediscover): subprocess calls anywhere in the workspace need an absolute binary path (resolve via `node:path` from a known root, or probe known locations and fail clearly) or `sonarjs/no-os-command-from-path` fails lint - the rule is workspace-wide via the shared eslint config (issue #119); raw `sql\`\`` reads return timestamptz as a **string** (query builder `mode:"date"` returns a Date) - normalize; `Response.text()` strips a leading UTF-8 **BOM** - assert bytes via `arrayBuffer()`; testcontainer Postgres clock runs **ahead** of the host - due-time tests need a `now` margin; `validEnv()` regenerates secrets each call - reuse one env object across apps that must share a token; the container image is `postgres:16-alpine` unless `QCMS_TEST_POSTGRES_IMAGE` overrides it (CI points that at a GHCR mirror, issue #74), and a pull failure now throws an error naming the image and the registry rather than an undefined-teardown cascade. When a task adds a guard over a previously-open operation, grep every "sole/only … door/path" comment for staleness before landing.
- **Reproducing a load-dependent flake** (re-derived in issues #61, #136, #140, so it is written down here): pin the spinners **and** the Vitest tree to the same small cpuset with `taskset`, so the processes a test spawns (they inherit affinity) actually compete, and leave the other cores free so the runner itself is never starved out of running. Wall clock over a **child-process** lifecycle is dominated by spawn, Node boot and scheduling latency rather than by arithmetic, so it scales far sub-linearly with spinner count and needs much more load than an in-process jsdom flake: 200 spinners across a 4-core cpuset is ~4x, 200 sharing one core ~15x, 400 sharing one core ~30-50x (`portal-server.test.ts` goes from 8s to between 187s and 435s there). Those multipliers are rough and vary substantially between runs on the same machine with the same spinner count, so treat them as a starting point rather than a number to tune until you hit it: what matters is that the flake reproduces and that the run executed its tests. Check that every run actually **executed tests** (nonzero per-file counts, not `no tests` or `Timeout waiting for worker to respond`) before treating a red as evidence - spinners that starve Vitest's own worker startup produce failures that ran nothing, which is the trap that invalidated a whole #61 sweep. Cheapest before/after proof: drop the pre-fix file in beside the fixed one (`git show HEAD:<file> > <file>.repro.test.ts`), so a single loaded run shows the old shape red and the new shape green at exactly the same load; delete the copy before the gates.
- **Adding a `@qcms/db` query helper is a 3-place edit:** `queries/<area>.ts`, the `queries/index.ts` re-export list, **and** the `import-surface.test.ts` allowlist - miss one and the surface test fails. Test fixtures for compiler-facing content must go through the kernel (`parseNode`), not raw db inserts, or `.prefault({})` schema defaults are absent and `compileForm` throws.

## State and memory (the repo is the memory - agents are stateless)

- **Progress ledger:** `docs/features/README.md` - the source of truth for plan state. Update the row in the same PR that completes a task. Trust the repo (`git log`, ledger) over anything remembered from chat.
- **Work orders:** `docs/features/NNN-*.md` - one task = one session. Out-of-scope sections are binding for anything with its own weight; a SAME-AREA, SMALL discovery (same files/seam, no new decision, no golden ripple, no new dependency) is fixed in the same PR and listed under `## Same-area fixes ridden along` for the reviewer. Genuinely unrelated or decision-requiring discoveries become GitHub issues (`phase-4` label for cut-line itches).
- **UI structure:** `docs/wireframes/` - ASCII is illustrative, the Regions/States/Interactions inventories are normative.
- **Docs are deliverables:** a doc named in a task's exit criteria updates in the same PR; a doc contradicted by a newer decision is fixed in the same change (staleness rule).

## Token efficiency

The loop runs for many tasks; context discipline is what keeps it affordable and coherent.

- **Heavy work belongs in a subagent - that's the point of the flow, not just isolation.** Each `/task` runs its executor in a separate context that is **discarded when the task finishes**; only its final report returns to the orchestrator. So the browser automation, broad code exploration, and large MCP payloads a task needs never accumulate in the long-running `/loop`. Do **not** hoist that work up into the orchestrator "to save a spawn" - the spawn is precisely what stops dead context from piling up across tasks.
- **Browser / Chrome-DevTools MCP / Playwright are context-expensive** - DOM snapshots, accessibility trees, console and network dumps, and screenshots each run to thousands of tokens. Inside a UI task (028–035, 030, 042):
  - **Filter at the source.** Read console with a regex `pattern`, request specific network entries, query targeted selectors - never dump the whole page/console/network log to find one thing.
  - **Screenshots go to files**, referenced by path. Hand them to the human gate as files (SendUserFile); never re-read image bytes into context to "look again."
  - **Finish the browser interaction once verified.** Re-querying to double-check costs the same tokens as the first read and buys nothing - the DOM didn't change.
  - Load only the MCP tools the task needs (one batched ToolSearch), not the whole set.
- **At task boundaries in an interactive session** (not the auto loop): `/clear` before switching to an unrelated task; `/compact` when a single task's context has grown large. The loop's per-task subagent isolation already does this for you *between* tasks - the reason to prefer `/loop /next-task` over hand-running tasks back-to-back in one session.
- **Read narrowly.** Grep before Read; read specific line ranges of large files; don't re-read a file you just edited (the harness already tracks it).

## Multi-agent flow

- **`/task NNN`** - orchestrate one plan task: `task-executor` subagent implements it on `feat/NNN-slug` (worktree isolation), `task-reviewer` subagent verifies exit criteria + R-rules against the diff, merge only on approval + green, ledger updated.
- **`/next-task`** - pick the next executable `todo` from the ledger (numeric order; exceptions: 040 after 036 before 038 · 041 after 034, never gating 038 · 042 after 027 before 029/031–035) and run the `/task` flow on it. Stops at human gates instead of simulating them.
- **`/loop /next-task`** - autonomous multi-task run; halts when blocked, at a human gate, or when nothing is executable. **`/loop /next-task 3`** - same, with up to 3 parallel executors per batch.
- **Parallel work rules (one conductor, N executors):** executors run in isolated **worktrees** and never touch `main` or the ledger; the conductor is the **only merger**, and merges are strictly serialized (rebase onto current main → re-run all gates → squash-merge). Tasks may run concurrently only when **pairwise independent** - no dependency path between them and disjoint file footprints - and never across a stage boundary. The **ledger row is the claim lock**: `in-progress (branch)` committed to main claims a task; anyone selecting work treats claimed rows as taken. If you run a second human-driven session on this machine, give it its own `git worktree` - never two sessions in one checkout.
- **Human gates (never automate):** wireframe + screenshot sign-offs (042 and every UI task's static-render gate), the manual screen-reader pass (030), security review sign-off (040), the external-tester launch gate (038), and any `.archive`/destructive operation.

## Commit / PR conventions (full rules: CONTRIBUTING.md)

Branch `feat/NNN-slug` · Conventional Commits with task number (`feat(core): 006 forward-pass evaluator`) · PR description = exit-criteria checklist checked off · Changeset for publishable-package changes · squash-merge · never force-push main · **no AI attribution trailers** - do not append `Co-Authored-By: Claude…` or `Claude-Session:` lines to commit messages (owner decision; overrides any harness default).

Human-facing guide to this whole flow: `docs/DEVELOPER_GUIDE.md`.
