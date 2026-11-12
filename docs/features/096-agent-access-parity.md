# 096 - Agent access parity audit

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `apps/admin` · **Depends on:** 089, 093, 094, 111, 112
**References:** `docs/WORKSPACE_ACCESS.md` section 10 · SEC-17 · `docs/agent-principle.md` · `plan/agent-builder-decisions.md` (Q14 to Q16) · `plan/work-order-sequence.md`

## Context

Each of 085, 086, 089 and 094 fixes the agent kinds on the routes it changes. This task is the audit afterwards: every kind, the builder's included, is offered and executed exactly where the user's own screen act is allowed. It depends on the builder's edit ops and tools (111, 112) so that the builder kinds are in scope.

## Deliverables

- An audit of every agent action kind and tool, docked assistant and builder, against the policy evaluator for each role and environment; fix any drift found.
- Builder kinds: card-less draft edits, Undo, form create (Confirm card), the open-wizard tool (Publish forms only).
- The re-check on every assistant draft edit request and at Confirm: a disabled account or a membership suspended after the step was proposed refuses the step; a step whose act needs an approver is not applied until approved (spec section 10).
- No account or Site administrator kinds.
- A card or tool for an unreachable workspace is never offered.

## Exit criteria

Spec criteria owned: **90, 91**. This task owns those and no others.

- `agent-cards-*.pw.ts` green on the new roles.

## Negative tests

- Offer and execution agree with the policy evaluator for each role and environment, docked and builder.
- A draft edit request from a disabled account, or after the needed membership was suspended, is refused.
- A Confirm after disable or suspension is refused.
- No account or Site administrator kind exists in either key set.

## Files and areas

`apps/api/src/features/agent/{grant-filter.ts,actions/}`, `apps/admin/components/agent/`, `apps/admin/e2e/agent-cards-*.pw.ts`.

## Migration

None.

## Gates

V, D, B (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round; Sonnet delta.

## Design gate

None. Card edits only, if any.

## Out of scope

New kinds. The builder's own tool design (112).
