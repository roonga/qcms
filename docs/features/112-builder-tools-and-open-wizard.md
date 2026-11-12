# 112 - Builder tools and the open-wizard tool

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api` · **Depends on:** 111, 094
**References:** `plan/agent-builder-decisions.md` (G3, G4, Q14, Q16, "Required tests": Injection, Authorisation) · SEC-17 · `docs/features/041-agent-form-building.md` · `plan/work-order-sequence.md`

## Context

The model-facing half of the builder. Edit tools produce 111's draft-scoped edits; the agent may open the publish wizard but never publishes. G4 is split: G4a here covers the system prompt and fake-model scripts for the edit and open-wizard tools; G4b (117) covers the theme kinds.

## Deliverables

- G3:
  - Builder edit tools (question, step, rule, copy) emitting draft-scoped edits through 111's route kind, offered only to an Edit forms holder of the form's workspace, decided by the same evaluator as the screen (SEC-17).
  - The open-wizard tool: offered only to a Publish forms holder; opens the wizard (094) with `returnTo` for this form; executes nothing.
  - The builder's tool and action key set holds no publish, release, link or webhook kind.
- G4a: the builder's system prompt section in `system-prompt.ts` and `fake-model.ts` scripts for edit, Undo and open-wizard turns.
- Tool registration in `apps/api/src/features/agent/tools/registry.ts` and `grant-filter.ts`.

## Exit criteria

Spec criteria owned: none.

- The builder surface cannot reach publish, release, links, webhooks, erase or responses.

## Required tests

- Injection (X4, G3): a library question whose text instructs the model to publish leads to no publish, no release and no wizard execution, only at most an open-wizard offer for a Publish forms holder.
- Authorisation (X3): the open-wizard tool absent without Publish forms; edit tools absent for a View forms holder.
- Key set: a test pins the builder key set and fails on any publish, release, link or webhook kind.
- Tools sentinel (X4): tool arguments and results stay inside SEC-17's allowed vocabulary.
- Fake-model scripts run green for each tool.

## Files and areas

`apps/api/src/features/agent/tools/{registry,propose,propose-schema,tool-schema}.ts`, `apps/api/src/features/agent/{grant-filter,system-prompt,fake-model,assistant}.ts`, `apps/api/src/features/agent/actions/registry.ts`, their tests.

## Migration

None.

## Gates

V, D (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round (model-reachable surface); Sonnet delta.

## Design gate

None. No UI.

## Out of scope

Create card and builder UI (115). Theme kinds and their prompt (117). `returnTo` validation (113).
