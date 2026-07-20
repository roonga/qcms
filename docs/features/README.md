# features/ — Ordered task files

Each file is a self-contained work order for one agent session (or one focused human session). Execute in numeric order (exceptions: 040 runs after 036, before 038; 041 runs any time after 034 and **never gates 038** — ADR-25; 042 runs after 027, before 029 and 031–035 — the wireframe pass); the **Depends on** header lists hard prerequisites. Files never expand their own scope — discoveries become issues.

**Self-containedness convention:** a task is self-contained *given the repo's `docs/` set* — task files carry the what/why/done, and point at the specific doc sections that carry contracts (schemas, semantics, layouts) so those live in one place and can't drift. 001 bootstraps the docs into the repo, so every later session finds its references locally. If a referenced section is missing or contradicts the task, that's a blocking issue — stop and surface it, don't improvise. Tasks needing anything *outside* the repo (e.g. the `a2-react-aria` repo in 011/028) declare it in an **External input required** header.

## Agent execution protocol

(Normative long form: `AGENTIC_DEVELOPMENT.md` §3.)

1. Read `PROJECT_INSTRUCTIONS.md` (rules R1–R7 + amendments), then the task file, then the **References** it lists. Check the **progress ledger below** and `git log` — trust the repo over memory.
2. Do only what the task's Deliverables and Exit criteria require. **Out of scope** sections are binding. Blocked on a genuine decision → stop and ask; never choose silently.
3. Tests ship with the code; docs named in the task are updated in the same change.
4. A task is done only when every exit criterion passes and `pnpm build && pnpm test && pnpm lint` is green at the repo root. **Update the ledger status in the same PR.**
5. **Green or clean:** if a session can't finish, either revert to green or park on the task branch with a `HANDOFF.md` (state, next step, what's red). Never merge red; never leave main broken.
6. Branch `feat/NNN-slug`; task number in commit messages; PR description is the exit-criteria checklist, checked off.
7. **Review before merge:** a human, or a second agent session given only the task file + diff, verifies exit criteria and rule compliance (R1–R7, cut-line, SEC controls). The reviewer verifies; it never extends the work.
8. Record anything tempting-but-out-of-scope as a GitHub issue (label `phase-4` if it's beyond the cut-line).

## Index and progress ledger

Status values: `todo` · `in-progress (branch)` · `blocked (issue #)` · `done (PR #)`. Update in the completing PR — this table is the cross-session source of truth for plan state.

| # | Task | Stage | Status |
|---|---|---|---|
| 001 | Repository bootstrap | 0 | done |
| 002 | Core IDs, LocalizedText, canonical AnswerValue | 1 | done |
| 003 | Question-type definitions | 1 | done |
| 004 | FormDefinition and typed publish errors | 1 | done |
| 005 | Rules DSL schemas and dependency graph | 2 | done |
| 006 | Rules evaluator (forward pass) | 2 | done |
| 007 | Evaluator test corpus | 2 | done |
| 008 | compileDraft publish aggregate | 3 | done |
| 009 | Answer validation and submission lock | 3 | done |
| 010 | Secure-link tokens (core) | 3 | done |
| 011 | A2UI compiler | 4 | done |
| 012 | A2UI golden corpus and agent seam | 4 | done |
| 013 | DB schema, migrations, test harness | 5 | done |
| 014 | Query helpers | 5 | done |
| 015 | Reporting view and retention sweep | 5 | done |
| 016 | Erasure (ADR-17) | 5 | done |
| 017 | API composition root | 6 | done |
| 018 | start-session slice | 6 | done |
| 019 | get-step and submit-answer slices | 6 | done |
| 020 | submit slice (lock + outbox) | 6 | done |
| 021 | Question authoring slices | 6 | done |
| 022 | Form authoring and publish slices | 6 | done |
| 023 | Response listing, export, erasure slices | 6 | done |
| 024 | Secure-link minting and webhook config slices | 6 | todo |
| 025 | Webhook deliverer worker | 6 | todo |
| 026 | Abuse controls | 6 | todo |
| 027 | API end-to-end suite | 6 | todo |
| 028 | A2UI renderer (`packages/ui`) | 7 | todo |
| 029 | Portal app (SSR + BFF) | 7 | todo |
| 030 | Portal accessibility pass | 7 | todo |
| 031 | Admin shell and 2FA auth | 8a | todo |
| 032 | Admin question library | 8a | todo |
| 033 | Admin form builder and condition editor | 8a | todo |
| 034 | Admin publish, preview, versions, secure links | 8a | todo |
| 035 | Admin responses, erasure, webhook operations | 8a | todo |
| 041 | Agent-assisted form building (flag-gated; off the launch gate — ADR-25) | 8a | todo |
| 042 | UI wireframes (lo-fi pass; runs after 027, before 029/031–035) | 7 | todo |
| 036 | Production images, compose, ops docs | 8b | todo |
| 037 | create-qcms-app CLI | 8b | todo |
| 040 | Security review and hardening (runs after 036, before 038) | 8b | todo |
| 038 | Launch-gate validation | 8b | todo |
| 039 | Phase-4 backlog recording | 9 | todo |

Note: 040 was added after initial numbering; it executes between 036/037 and 038. Security controls are designed in `SECURITY_DESIGN.md` (SEC-1…12) and largely delivered inside feature tasks — 040 verifies them as a system.
