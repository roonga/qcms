# QCMS — Agentic Development Methodology

**Status:** v1.0 · how this project is built with AI agents, and the checklist its plan is audited against
**Premise:** agents are brilliant executors with two structural traits — **amnesia** (every session starts cold) and **no restraint** (underspecification gets filled confidently and wrongly; scope creeps unless bounded). Everything below follows from designing around those two traits.

> **Methodology vs. runbook:** this doc is the *why* — principles and the audit checklist. For the operator's *how* (launching, `/task`/`/loop`, gates, monitoring) see [`DEVELOPER_GUIDE.md`](DEVELOPER_GUIDE.md).

---

## 1. Principles

### 1.1 Documents are the agent's memory

The persistent state of the project is its document set, not anyone's head. Therefore: few documents, each authoritative for one concern, current, and cross-referenced — agents follow references well but cannot guess which of several stale docs wins.

This project's set: `PROJECT_GOAL.md` (vision, scope, ADRs) · `ARCHITECTURE.md` (system design, repo layout) · `DOMAIN_SCHEMA.md` (domain model) · `SECURITY_DESIGN.md` (SEC decisions) · `IMPLEMENTATION_PLAN.md` (stages) · `features/` (task files) · `PROJECT_INSTRUCTIONS.md` (read-first rules). **Staleness rule:** a doc contradicted by a newer decision is corrected or banner-marked as superseded *in the same change that makes the decision* — a stale authoritative doc is worse than none, because an agent will follow it.

### 1.2 Decisions carry rationale (ADRs)

An agent that knows *what* was chosen but not *why* will "improve" it. Every decision that must survive contact with future agents is recorded with its why (ADR-01…25, SEC-1…12) and never relitigated in a task — conflicts are flagged, not resolved ad hoc.

### 1.3 Short, numbered, checkable rules

Discipline rules (R1–R7) are enforceable at review by mechanical checks where possible ("core never imports db" → import-surface test), not vibes ("keep it clean"). The read-first file (`PROJECT_INSTRUCTIONS.md`) is small enough to actually be read at the start of every session.

### 1.4 Ambiguity is resolved in documents, before code

Humans ask when unsure; agents pick something plausible and proceed. Any semantic left underspecified will be specified for you, randomly, by whichever agent reaches it first — and then frozen by the tests that agent writes. Semantics that freeze into data (evaluation rules, encodings, token formats) get decided at design time (ADR-16, the AnswerValue decision in task 002's spec, SEC-2/5/6).

### 1.5 Architecture follows the testability gradient

Pure core → I/O → UI. Agents are most reliable where feedback is instant, deterministic, and machine-checkable; a headless kernel with total coverage is agent-friendly terrain, a half-mocked UI is not. Build and prove the kernel before HTTP exists; HTTP before UI (the plan's spine).

### 1.6 Exit criteria, not estimates

Agents make effort estimates meaningless and "done" ambiguous. Every stage and task gates on observable, mostly machine-checkable criteria. CI green is the only trust anchor between sessions.

### 1.7 Verification machinery is built early and drift-proofed

Golden files, property tests, conformance suites, append-only corpus guards, permanent regression suites (the 040 matrix stays in CI). These are how agent N+1 avoids silently breaking agent N's work.

### 1.8 Human-in-the-loop points are explicit

Design decisions, wireframe sign-off (042) and the per-screen static-render screenshot gates in every UI task, manual accessibility passes (030), the external-tester launch gate (038), security review sign-off (040). Marked in the task files so agents prepare for them rather than routing around or simulating them.

### 1.9 Division of labor

The human owns decisions, taste, and review; agents own execution and verification; the documents are the interface between them. Time spent making documents unambiguous repays itself multiplied across every future session.

## 2. Task design rules

1. **One task = one agent session**, sized so the task file plus its referenced contracts fit in context with room to work.
2. **Self-contained work order:** context (why this exists), hard dependencies, references to the *specific* sections that govern it, concrete deliverables, exit criteria, and a **binding out-of-scope** section — scope creep is the top agent failure mode, and "don't" must be written per task.
3. **Tests are the handoff contract.** They ship with the code and encode what the session promised the next one.
4. **Discoveries become issues, never expansions.** Beyond-cut-line itches get labeled `phase-4`.
5. **Docs named in a task are deliverables**, updated in the same change — this is how 1.1's staleness rule is honored in practice.

## 3. Session protocol (normative — agents follow this)

**Start:** read `PROJECT_INSTRUCTIONS.md` → the task file → its listed references. Check the progress ledger (`features/README.md` status column) and `git log` for the actual repo state — trust the repo over memory.

**During:** work only within deliverables/exit criteria; run tests continuously; when blocked by a genuine decision (not a lookup), stop and surface the question rather than choosing silently.

**End — every session leaves the repo green or clean:**
- Done: all exit criteria pass, `pnpm build && pnpm test && pnpm lint` green at root, docs updated, ledger updated.
- Not done: either revert to green, or park on the task branch with a `HANDOFF.md` note (state, next step, what's red) — **never merge red, never leave main broken.**

**Conventions:** one branch per task (`feat/NNN-slug`); task number in commit messages; PR description = exit-criteria checklist checked off.

**Review:** every task's merge is reviewed (human, or a second agent session given the task file + diff with instructions to verify exit criteria and rule compliance — not to extend the work). The cut-line and R-rules are enforced here, not remembered.

## 4. Audit checklist

Used to review this plan (and re-review after major changes). For each item: pass / gap / fix.

**Documents**
- [ ] D1. Every authoritative doc current or banner-superseded; no contradictions between docs.
- [ ] D2. Every decision that constrains future work has a recorded rationale.
- [ ] D3. A read-first instructions file exists, is short, and reflects the *current* doc set and rules.
- [ ] D4. Semantics that freeze into data are decided in docs, not deferred to implementation.
- [ ] D5. The doc set is complete as a drop-in: a fresh agent (or human) needs nothing outside the repo.

**Plan**
- [ ] P1. Stages ordered along the testability gradient; each lands an independently verifiable increment.
- [ ] P2. Every stage/task gated by observable exit criteria; no date-based gates.
- [ ] P3. Verification machinery (goldens, property tests, guards) built before or with the behavior it protects.
- [ ] P4. Human-in-the-loop points explicit, with agent-prepares/human-executes split stated.
- [ ] P5. Risks named with mitigations that are mechanisms, not intentions.

**Tasks**
- [ ] T1. Session-sized; dependencies explicit; no forward dependencies.
- [ ] T2. Each has context, references, deliverables, exit criteria, binding out-of-scope.
- [ ] T3. Tests-with-code and docs-in-same-change stated where relevant.
- [ ] T4. A progress ledger exists and the protocol requires updating it.
- [ ] T5. Failure/handoff behavior defined (green-or-clean rule).
- [ ] T6. Branch/commit/PR conventions defined; review step defined with reviewer instructions.

## 5. Known limits

This methodology reflects mid-2026 practice; principles (§1) are durable, tooling conventions (§3) shift — re-audit when the agent tooling changes materially. It also assumes a single human decision-maker; multi-human projects need an owner per document.
