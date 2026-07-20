# Workshop retro log

`FRICTION:` observations from executors and reviewers, appended by `/task` at each landing. Consumed by `/improve-workshop` (run at stage boundaries); processed entries get marked `[processed <date>]`, never deleted — this is also the audit trail of how the workshop evolved.

Seed entries (from the 2026-07-19/20 manual improvement pass, recorded retroactively so the pattern history starts complete):

## 001–008 — workshop shakedown [processed 2026-07-20]
- Executor worktrees leaked to disk and once into git → cleanup step + gitignore added to /task.
- Landings weren't pushed; 13 commits piled up locally → push-on-land added to /task.
- Usage-limit kills lost uncommitted work and stalled the loop → incremental WIP commits, stale-claim recovery, NEXT-TASK sentinel + scripts/agent-loop.ps1 supervisor.
- Skill edits didn't affect the running session → restart guidance; supervisor preferred for long runs.

## 009 — Answer validation and submission lock (2026-07-20) [processed 2026-07-20]
- Reviewer: exit criterion "contentHash stable across Node versions" is only indirectly verifiable on one machine — the committed golden hash is the cross-version tripwire; a CI matrix over Node versions would make it directly checkable.

## 010 — Secure-link tokens (core) (2026-07-20) [processed 2026-07-20]
- Executor: no repo convention for where package-scoped lint rules live (root flat config vs per-package) — a one-line note in CONTRIBUTING or the eslint config header would have saved an ad-hoc decision. Also, root `pnpm lint` includes a Prettier check but nothing tells executors to format new files first — cost one red-green cycle; a "format new files before lint" note in the executor protocol would prevent it.
- Reviewer: the v8 text coverage reporter silently omits 100%-covered files, so per-file coverage evidence needs `--coverage.reporter=json-summary`; and `turbo lint` cache hits can replay green logs without exercising a changed `eslint.config.js` — list it in `turbo.json` globalDependencies (or run `eslint src` uncached when the config changed).

## 011 — A2UI compiler (2026-07-20, parked blocked; resumed + landed 2026-07-20) [processed 2026-07-20]
- Executor: the task file's own header predicted this exact blocker ("candidates known today: multiline text for `longText`") — a pre-flight upstream check at planning time (or filing the upstream issue when 011 was authored) would have saved the session spin-up entirely.
- Executor: `npm view` is denied by the pnpm-only permission rules even for read-only registry metadata; `pnpm view` works — a CLAUDE.md note ("use pnpm view/dlx for registry queries") would prevent one wasted denial round-trip.
- Reviewer: a stray NUL byte (0x00) used as a delimiter in shipped source passed build+typecheck+test+lint+prettier because it was a *consistent* delimiter — only `git diff` flagging the file `Bin` caught it. The gate has no binary/control-char guard; a one-line CI/pre-commit check (reject `\x00` in `*.ts`, or `git diff --numstat` yielding `-` for a text file) would prevent an unreviewable-diff class permanently. A pre-existing NUL in `packages/core/src/rule-graph.ts` (task 006, already on main) was found by the same scan — tracked separately.
- Executor (upstream, ADR-22): `@a2ra/core`'s shipped `.d.ts` files use `.ts`-extension internal imports, which `tsc` tolerates via `skipLibCheck` but `typescript-eslint`'s no-unsafe-* rules reject — cost a rework of the schema-validation test to a wrapped `parseNode` with one scoped, commented `eslint-disable` in test code. Upstream d.ts packaging defect.
- Conductor: `git reset --hard origin/<branch>` on an executor branch that was pushed only in its stale parked state silently discarded the executor's unpushed implementation commits (recovered from reflog). Lesson: never reset an executor branch to origin — executors don't push their work; the local ref is the source of truth. Reconcile via rebase, not reset-to-origin.

## 012 — A2UI golden corpus and append-only policy (2026-07-20) [processed 2026-07-20]
- Executor: the task said to build snapshots "as 011's kitchen-sink golden did", but 011 built its snapshot inline in the test while 012's deliverables point at the core JSON fixtures — two different sources; and the @qcms/core question-fixture set is locked one-per-type (question-definition.test.ts asserts it), so new form fixtures must reuse the existing 7 question fixtures. A one-line note in the task file would have saved the exploration.
- Reviewer: the append-only guard's `-M` rename detection surfaces a file renamed *into* golden/ as `R` (violation), not `A` — a legitimate-but-rare way to add a golden. Note in golden/README that new goldens must be introduced as fresh adds, not moves.
- Discovery (not acted on): the one-per-type question-fixture lock means a >7-option singleChoice (→ Select rendering) and an integer:false number aren't exercised by the golden/v1 corpus (still covered by 011's inline kitchen-sink test). If 028's renderer conformance wants them in the shared corpus, it needs a corpus-local inline fixture or a relaxation of the invariant.

## Stage 3 boundary — CI red streak (2026-07-20) [processed 2026-07-20]
- CI failed on every push since ~008 while local gates stayed green: the canonical gate omitted `pnpm typecheck` (CI runs it; `build` doesn't cover test-file types). One real TS18048 in form-definition.test.ts rode along for 10 landings. Fixed: error patched, typecheck added to the gate in /task, executor, reviewer, CLAUDE.md, CONTRIBUTING. Lesson: the gate definition must be a superset of CI, verified by comparing against ci.yml whenever either changes.
