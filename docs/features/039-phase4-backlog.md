# 039 — Phase-4 backlog recording

**Stage:** 9 · **Scope:** issue tracker · **Depends on:** 038 (launched)
**References:** `IMPLEMENTATION_PLAN.md` Stage 9 · R7 · `ARCHITECTURE.md` §12 (reserved seams)

## Context

Phase 4 is demand-ordered: nothing here is built on a schedule; each item waits for pull (a real user, a real integrator, real evidence). This task converts the deferred list into well-formed issues so the cut-line has a ledger — write the itch down, don't scratch it.

## Deliverables

One `phase-4` labeled issue per item, each with: motivation, the reserved seam it lands behind (from `ARCHITECTURE.md` §12), an acceptance sketch (not a design), and its trigger condition (what demand signal activates it):

1. **OTP + social respondent auth** — better-auth adapter surface; trigger: a deployment needing verified-but-not-preregistered respondents.
2. **Library cascade UX, staged:** (a) outdated-pin surfacing, (b) breaking-change classification, (c) cross-form impact analysis — question-versioning machinery already structural; trigger: a library with enough reuse that manual pinning hurts.
3. **`/api/v1`** — scoped tokens, generated OpenAPI via `@hono/zod-openapi`; trigger: a real integrator asking to pull.
4. **Locale-switching UX** — schema is ready (ADR-11); trigger: first multilingual deployment.
5. **Agent-adaptive serving flows** — behind the `StepResolver`/compiler seam (never launched lightly; a versioned-semantics event if ever). Agent-assisted *authoring* moved to launch scope as task 041 (ADR-25); this item is only the serving-path half. Trigger: a use case immutable published flows genuinely cannot express.
6. **File-upload question type** — versioned core change + storage story (object store adapter — new seam decision needed, flag for ADR); trigger: a flow that needs documents. *(Review-identified gap: recorded so it's a decision, not an omission.)*
7. **Visual condition builder** — emits the same DSL (ADR-03 designed for this); trigger: author feedback on the structured editor.
8. **Bun runtime** — fetch-pure handlers keep it a base-image change (R4); trigger: measured performance need.
9. **Multi-tenancy recipe** — documented derivative, not schema tax (ADR-04); trigger: real SaaS demand.
9a. **Runtime feature-flag provider** — DB-backed, toggleable without restart, behind ADR-24's registry seam (env stays the default provider); trigger: an operator who genuinely can't restart to flip a flag.
10. Items accumulated during Stages 0–8 under `phase-4` — dedupe, merge, and re-label into this structure.

Also: a `ROADMAP.md` pointing at the label, stating the demand-ordered principle publicly (adopters should know the rule).

## Exit criteria

1. All items above exist as issues with the four fields; stage-accumulated itches merged.
2. `ROADMAP.md` committed.
3. Nothing was built. (Really. The exit criterion of this task is restraint.)
