# qcms — Claude Code guide

Question CMS (**qcms**): an MIT-licensed TypeScript engine for questionnaires with deeply conditional logic, distributed shadcn-style (owned scaffolded shell + versioned `@qcms/*` packages).

**Read first, every session: `PROJECT_INSTRUCTIONS.md`** — the binding rules (R1–R7), decisions (ADR-01…25, SEC-1…12), and session protocol. This file adds only harness wiring; where they overlap, PROJECT_INSTRUCTIONS wins.

**Roles:** sessions in this checkout are **implementation** sessions (this file governs them). The product-owner role exists separately, seated outside this checkout — its charter is `docs/PRODUCT_OWNER.md`. Never assume the PO role in a session here.

## Naming (settled)

| Thing | Name |
|---|---|
| Repo / product | `qcms` (Question CMS) |
| Publishable packages | `@qcms/core` · `@qcms/a2ui-compiler` · `@qcms/db` · `@qcms/ui` |
| Apps (private) | `qcms-api` · `qcms-portal` · `qcms-admin` |
| Scaffolding CLI | `create-qcms-app` |
| Env prefix / flag prefix | `QCMS_` / `QCMS_FLAG_` |
| ID prefixes | `q_ frm_ stp_ opt_ rul_ ses_ lnk_` (branded, never reused — R6) |

npm: `@qcms/*`, `qcms`, and `create-qcms-app` were all unclaimed as of 2026-07-19; create the npm org before first publish (Stage 5).

## Toolchain — hard rules

- **pnpm only.** Never npm or yarn (the `packageManager` field pins it from 001). CI uses `--frozen-lockfile`. Registry/version queries: `pnpm view <pkg>` (bare `npm view` is denied by the pnpm-only permission rules).
- **Vitest below the browser, Playwright for e2e** (ADR-23). No other test frameworks, ever.
- Gate for every merge: `pnpm build && pnpm typecheck && pnpm test && pnpm lint` green at root (**green-or-clean** — never merge red; park unfinished work on its branch with a `HANDOFF.md`).
- New dependencies follow `CONTRIBUTING.md`'s approval policy (thresholds + risk assessment in the PR).
- **DB/integration tests** use the Testcontainers harness in `@qcms/db` (exported at its `./testing` subpath — don't re-derive the Docker-credsStore workaround; import `withTestDb`). Force-run them (`--force`) — turbo cache replays logs without booting Postgres. DB-testing traps (all cost a live cycle to rediscover): raw `sql\`\`` reads return timestamptz as a **string** (query builder `mode:"date"` returns a Date) — normalize; `Response.text()` strips a leading UTF-8 **BOM** — assert bytes via `arrayBuffer()`; testcontainer Postgres clock runs **ahead** of the host — due-time tests need a `now` margin; `validEnv()` regenerates secrets each call — reuse one env object across apps that must share a token. When a task adds a guard over a previously-open operation, grep every "sole/only … door/path" comment for staleness before landing.
- **Adding a `@qcms/db` query helper is a 3-place edit:** `queries/<area>.ts`, the `queries/index.ts` re-export list, **and** the `import-surface.test.ts` allowlist — miss one and the surface test fails. Test fixtures for compiler-facing content must go through the kernel (`parseNode`), not raw db inserts, or `.prefault({})` schema defaults are absent and `compileForm` throws.

## State and memory (the repo is the memory — agents are stateless)

- **Progress ledger:** `docs/features/README.md` — the source of truth for plan state. Update the row in the same PR that completes a task. Trust the repo (`git log`, ledger) over anything remembered from chat.
- **Work orders:** `docs/features/NNN-*.md` — one task = one session. Out-of-scope sections are binding; discoveries become GitHub issues (`phase-4` label for cut-line itches), never task expansions.
- **UI structure:** `docs/wireframes/` — ASCII is illustrative, the Regions/States/Interactions inventories are normative.
- **Docs are deliverables:** a doc named in a task's exit criteria updates in the same PR; a doc contradicted by a newer decision is fixed in the same change (staleness rule).

## Token efficiency

The loop runs for many tasks; context discipline is what keeps it affordable and coherent.

- **Heavy work belongs in a subagent — that's the point of the flow, not just isolation.** Each `/task` runs its executor in a separate context that is **discarded when the task finishes**; only its final report returns to the orchestrator. So the browser automation, broad code exploration, and large MCP payloads a task needs never accumulate in the long-running `/loop`. Do **not** hoist that work up into the orchestrator "to save a spawn" — the spawn is precisely what stops dead context from piling up across tasks.
- **Browser / Chrome-DevTools MCP / Playwright are context-expensive** — DOM snapshots, accessibility trees, console and network dumps, and screenshots each run to thousands of tokens. Inside a UI task (028–035, 030, 042):
  - **Filter at the source.** Read console with a regex `pattern`, request specific network entries, query targeted selectors — never dump the whole page/console/network log to find one thing.
  - **Screenshots go to files**, referenced by path. Hand them to the human gate as files (SendUserFile); never re-read image bytes into context to "look again."
  - **Finish the browser interaction once verified.** Re-querying to double-check costs the same tokens as the first read and buys nothing — the DOM didn't change.
  - Load only the MCP tools the task needs (one batched ToolSearch), not the whole set.
- **At task boundaries in an interactive session** (not the auto loop): `/clear` before switching to an unrelated task; `/compact` when a single task's context has grown large. The loop's per-task subagent isolation already does this for you *between* tasks — the reason to prefer `/loop /next-task` over hand-running tasks back-to-back in one session.
- **Read narrowly.** Grep before Read; read specific line ranges of large files; don't re-read a file you just edited (the harness already tracks it).

## Multi-agent flow

- **`/task NNN`** — orchestrate one plan task: `task-executor` subagent implements it on `feat/NNN-slug` (worktree isolation), `task-reviewer` subagent verifies exit criteria + R-rules against the diff, merge only on approval + green, ledger updated.
- **`/next-task`** — pick the next executable `todo` from the ledger (numeric order; exceptions: 040 after 036 before 038 · 041 after 034, never gating 038 · 042 after 027 before 029/031–035) and run the `/task` flow on it. Stops at human gates instead of simulating them.
- **`/loop /next-task`** — autonomous multi-task run; halts when blocked, at a human gate, or when nothing is executable. **`/loop /next-task 3`** — same, with up to 3 parallel executors per batch.
- **Parallel work rules (one conductor, N executors):** executors run in isolated **worktrees** and never touch `main` or the ledger; the conductor is the **only merger**, and merges are strictly serialized (rebase onto current main → re-run all gates → squash-merge). Tasks may run concurrently only when **pairwise independent** — no dependency path between them and disjoint file footprints — and never across a stage boundary. The **ledger row is the claim lock**: `in-progress (branch)` committed to main claims a task; anyone selecting work treats claimed rows as taken. If you run a second human-driven session on this machine, give it its own `git worktree` — never two sessions in one checkout.
- **Human gates (never automate):** wireframe + screenshot sign-offs (042 and every UI task's static-render gate), the manual screen-reader pass (030), security review sign-off (040), the external-tester launch gate (038), and any `.archive`/destructive operation.

## Commit / PR conventions (full rules: CONTRIBUTING.md)

Branch `feat/NNN-slug` · Conventional Commits with task number (`feat(core): 006 forward-pass evaluator`) · PR description = exit-criteria checklist checked off · Changeset for publishable-package changes · squash-merge · never force-push main · **no AI attribution trailers** — do not append `Co-Authored-By: Claude…` or `Claude-Session:` lines to commit messages (owner decision; overrides any harness default).

Human-facing guide to this whole flow: `docs/USING_THE_AGENTS.md`.
