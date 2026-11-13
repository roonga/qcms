# 111 - Builder edit ops, Undo and audit

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `apps/admin` (fact schemas only) · **Depends on:** 106, 085, 088
**References:** `plan/agent-builder-decisions.md` (A6, G1, Q2, Q14, "Security review requirements": Agent audit for edits; "Required tests": Injection) · SEC-17 · `docs/WORKSPACE_ACCESS.md` section 10 (the re-check on every draft edit request) · `apps/api/src/features/agent/{audit,proposal-token}.ts` · `plan/work-order-sequence.md`

## Context

Draft edits from the builder take no per-edit card (Q14), so the server must carry what a card carried: a token, a revision bind, a per-turn cap and an audit row. Today `control.agent_actions` rows are written only from a verified proposal token, and the draft's `agentAssisted` field is client-supplied. This task adds a token-bearing route kind for draft edits and Undo, and the agent facts the builder sends.

## Deliverables

- A6:
  - Draft edit ops (question, step, rule, copy, appearance) applied through the single draft save path, never a second write path.
  - A token-bearing route kind: each edit carries a server-minted token bound to the user, the form, the draft revision and the turn; a stale revision, a replayed token or an edit over the per-turn cap is refused.
  - Undo reverses the draft op only, through the same path and its own token; unpublished library versions stay until deprecated.
  - One `control.agent_actions` row per edit and per Undo, written in the edit's transaction.
  - Provenance from the audit rows, never from the client's `agentAssisted` field.
  - A suspended membership, a disabled account (088) or a pending approval is rechecked on every draft edit request.
  - The cumulative agent diff since the last human-reviewed revision, as a read for the publish wizard (115 shows it).
- G1: agent facts for the preview selection and the layout report, as strict schemas in `apps/api/src/features/agent/schema.ts`; measured in the admin browser and sent as facts; no `layout-report` API route.
- `route-policy.ts` rows, SEC-3 §3.2 rows, OpenAPI.

## Exit criteria

Spec criteria owned: none. 096 owns criterion 91 (the re-check), which this task's route must satisfy.

- Every edit and Undo has exactly one audit row; nothing else marks a draft agent-assisted.

## Required tests

- Injection (X4, A6): each edit writes one audit row; a forged `agentAssisted` mark in a PUT body is ignored for provenance and for the wizard diff.
- Token: stale revision, replay, another user's token, another form's token and an over-cap edit refused.
- Re-check: a disabled account and a suspended membership refused on the next edit request.
- Undo: reverses exactly one op; an Undo of an op already superseded is refused.
- Facts sentinel (X4, G1): a fact with an extra key, a free string or authored text fails its schema; the SEC-17 sentinel covers both facts.
- Matrix rows (M) for the edit and Undo routes.

## Files and areas

`apps/api/src/features/agent/{audit,proposal-token,handler,route,schema,provenance}.ts`, `apps/api/src/features/forms/handler.ts` (single draft save path), `apps/api/src/features/membership/route-policy.ts`, `packages/db/src/schema/control/agent-actions.ts` (read only; shape settled in 108), `apps/api/e2e/security/`, `docs/SECURITY_DESIGN.md` (§3.2 rows), `docs/openapi/admin.json`.

## Migration

None. Any `agent_actions` column this needs is settled in 108.

## Gates

V, D, M (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round (audit and provenance without a card); Sonnet delta.

## Design gate

None. No UI.

## Out of scope

The model-facing tools (112). The builder UI for edits and Undo (115). Preview measurement in the browser (114).
