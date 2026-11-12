# 119 - Portal steps list and progress modes

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `apps/portal` · **Depends on:** 108; the rail states on the Agent Builder design canvas seen by the Code Owner
**References:** `plan/agent-builder-decisions.md` (A5, P2, Q8, review findings) · ADR-28 · `apps/api/src/features/responses/serve-step/schema.ts` · `docs/portal-constraints.md` · `plan/work-order-sequence.md`

## Context

In this programme by Code Owner ruling (2026-11-13), but it may slip past the builder's landing without blocking 121's closure of the other tasks.

Serve-step progress is only `{stepIndex, totalVisibleSteps}`. The rail needs an ordered list of every step, with rule-hidden steps shown as "Not needed", and back-jumps to completed steps through the existing cursor. The progress mode is part of the version's appearance (107's schema, 108's column).

## Deliverables

- A5:
  - Serve-step returns an ordered `steps` list: label, state (completed, current, ahead, "Not needed"), and the current step's question labels; the progress mode from the pinned version's appearance.
  - Back-jump to a completed step through the existing cursor; a forward jump refused.
  - OpenAPI regenerated.
- P2:
  - Progress modes: side rail, top indicator, none.
  - No-JS: the rail's completed steps are plain links that work without script.
  - The narrow fold: below the breakpoint the rail folds into the top indicator with a disclosure.
- Strings in `apps/portal/lib/i18n/en.ts`; "Not needed" is the one word for rule-hidden steps.

## Exit criteria

Spec criteria owned: none.

- No step label or state leaks a rule's condition or another respondent's data.

## Required tests

- X1 (Vitest): rail state derivation from the cursor and rule visibility, including a step hidden after a back-jump changes an answer.
- API: forward jump refused; back-jump to a completed step accepted; steps list order matches the version.
- Playwright portal (X2): rail at 1024 and 390 px, top indicator and none modes, no-JS back-jump, narrow fold, axe clean.

## Files and areas

`apps/api/src/features/responses/serve-step/{handler,schema,route}.ts` and its integration test, `apps/portal/components/{step-flow,progressive-step,native-step,portal-shell}.tsx`, `apps/portal/app/s/[sessionId]/`, `apps/portal/lib/i18n/en.ts`, `apps/portal/e2e/`, `docs/openapi/`.

## Migration

None.

## Gates

V, D, B, E (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: the three progress modes, the rail states and the narrow fold on the Agent Builder canvas, seen by the Code Owner before dispatch.

## Out of scope

Choosing the progress mode in the admin (116). Per-form appearance (118).
