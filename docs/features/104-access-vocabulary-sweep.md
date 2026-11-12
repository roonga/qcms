# 104 - Access vocabulary sweep

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin`, docs · **Depends on:** 085; design batch 1 seen by the Code Owner
**References:** `docs/WORKSPACE_ACCESS.md` section 2 · `plan/work-order-sequence.md`

## Context

Copy only, first in the admin UI group, so the later screens start from the glossary.

## Deliverables

- The labels of spec section 2 across `en.ts`, help text and admin docs: Site administrator, Workspace administrator, the five role labels, Approver, Members, "people in this group", Grant and Revoke.

## Exit criteria

No spec criterion is owned here.

- No old label from the glossary's "Replaces" column remains in the admin UI or its docs.

## Negative tests

- Dead-key check passes; no key is left unused.

## Files and areas

`apps/admin/lib/i18n/en.ts`, `apps/admin/components/`, admin docs.

## Migration

None.

## Gates

V, B (`plan/work-order-sequence.md`, Gates).

## Review

Sonnet first round, confirming copy only; Sonnet delta.

## Design gate

Yes: batch 1 (glossary on the existing artboards).

## Out of scope

Code identifiers and API paths, which keep their names.
