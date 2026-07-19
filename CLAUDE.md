# qcms — Claude Code guide

Question CMS (**qcms**): an MIT-licensed TypeScript engine for questionnaires with deeply conditional logic, distributed shadcn-style (owned scaffolded shell + versioned `@qcms/*` packages).

**Read first, every session: `PROJECT_INSTRUCTIONS.md`** — the binding rules (R1–R7), decisions (ADR-01…25, SEC-1…12), and session protocol. This file adds only harness wiring; where they overlap, PROJECT_INSTRUCTIONS wins.

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

- **pnpm only.** Never npm or yarn (the `packageManager` field pins it from 001). CI uses `--frozen-lockfile`.
- **Vitest below the browser, Playwright for e2e** (ADR-23). No other test frameworks, ever.
- Gate for every merge: `pnpm build && pnpm test && pnpm lint` green at root (**green-or-clean** — never merge red; park unfinished work on its branch with a `HANDOFF.md`).
- New dependencies follow `CONTRIBUTING.md`'s approval policy (thresholds + risk assessment in the PR).

## State and memory (the repo is the memory — agents are stateless)

- **Progress ledger:** `docs/features/README.md` — the source of truth for plan state. Update the row in the same PR that completes a task. Trust the repo (`git log`, ledger) over anything remembered from chat.
- **Work orders:** `docs/features/NNN-*.md` — one task = one session. Out-of-scope sections are binding; discoveries become GitHub issues (`phase-4` label for cut-line itches), never task expansions.
- **UI structure:** `docs/wireframes/` — ASCII is illustrative, the Regions/States/Interactions inventories are normative.
- **Docs are deliverables:** a doc named in a task's exit criteria updates in the same PR; a doc contradicted by a newer decision is fixed in the same change (staleness rule).

## Multi-agent flow

- **`/task NNN`** — orchestrate one plan task: `task-executor` subagent implements it on `feat/NNN-slug` (worktree isolation), `task-reviewer` subagent verifies exit criteria + R-rules against the diff, merge only on approval + green, ledger updated.
- **`/next-task`** — pick the next executable `todo` from the ledger (numeric order; exceptions: 040 after 036 before 038 · 041 after 034, never gating 038 · 042 after 027 before 029/031–035) and run the `/task` flow on it. Stops at human gates instead of simulating them.
- **`/loop /next-task`** — autonomous multi-task run; halts when blocked, at a human gate, or when nothing is executable. **`/loop /next-task 3`** — same, with up to 3 parallel executors per batch.
- **Parallel work rules (one conductor, N executors):** executors run in isolated **worktrees** and never touch `main` or the ledger; the conductor is the **only merger**, and merges are strictly serialized (rebase onto current main → re-run all gates → squash-merge). Tasks may run concurrently only when **pairwise independent** — no dependency path between them and disjoint file footprints — and never across a stage boundary. The **ledger row is the claim lock**: `in-progress (branch)` committed to main claims a task; anyone selecting work treats claimed rows as taken. If you run a second human-driven session on this machine, give it its own `git worktree` — never two sessions in one checkout.
- **Human gates (never automate):** wireframe + screenshot sign-offs (042 and every UI task's static-render gate), the manual screen-reader pass (030), security review sign-off (040), the external-tester launch gate (038), and any `.archive`/destructive operation.

## Commit / PR conventions (full rules: CONTRIBUTING.md)

Branch `feat/NNN-slug` · Conventional Commits with task number (`feat(core): 006 forward-pass evaluator`) · PR description = exit-criteria checklist checked off · Changeset for publishable-package changes · squash-merge · never force-push main.
