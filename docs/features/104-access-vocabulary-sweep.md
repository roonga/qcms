# 104 - Access vocabulary sweep

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin`, `apps/api`, docs · **Depends on:** 085; design batch 1 seen by the Code Owner
**References:** `docs/WORKSPACE_ACCESS.md` section 2 · `plan/work-order-sequence.md`

## Context

Copy only, first in the admin UI group, so the later screens start from the glossary.

## Deliverables

- The labels of spec section 2 across `en.ts`, help text and admin docs: Site administrator, Workspace administrator, the five role labels, Approver, Members, "people in this group", Grant and Revoke.
- Version, in place of "published version", across the admin copy (Code Owner, 2026-11-16).
- Second approval, Approver and "a publish to production" in the assistant system prompt and the membership tool descriptions, with `SYSTEM_PROMPT_VERSION` bumped (Code Owner, 2026-11-16).
- `docs/environment-capabilities.md` named on the glossary, its "What a user can do" section included (Code Owner, 2026-11-16).

## Exit criteria

No spec criterion is owned here.

- No old label from the glossary's "Replaces" column remains in the admin UI or its docs.

## Negative tests

- Dead-key check passes; no key is left unused.

## Files and areas

`apps/admin/lib/i18n/en.ts`, `apps/admin/components/`, `apps/admin/e2e/`, `apps/api/src/features/agent/`, admin docs.

## Migration

None.

## Gates

V, B, and D for the `apps/api` text (`plan/work-order-sequence.md`, Gates).

## Review

Sonnet first round, confirming copy only; Sonnet delta.

## Design gate

Yes: batch 1 (glossary on the existing artboards).

## Out of scope

Code identifiers and API paths, which keep their names.
