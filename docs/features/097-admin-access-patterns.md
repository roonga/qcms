# 097 - Admin access patterns

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin`; `@roonga/qcms-ui` only if a control changes · **Depends on:** 104; design batch 2 seen by the Code Owner
**References:** `docs/WORKSPACE_ACCESS.md` section 13 · `docs/COMPONENT_GUIDELINES.md` · `plan/work-order-sequence.md`

## Context

The shared components every access screen uses, built once so 095 and 098 to 103 compose them.

## Deliverables

Components for the patterns of spec section 13:

- Access explanation (rows of action by environment, naming the granting group or "no group grants this").
- Preview before confirming.
- Confirmation levels (plain, typed name).
- Last-administrator control (disabled with reason and a link to appoint someone else).
- "No access yet" home.
- "No group covers this" notice, also after a group is deleted.
- Search and rail filter primitives (role, environment, status).

## Exit criteria

No spec criterion is owned here; the screens that use these components own theirs.

- Component tests cover every state on the batch 2 artboards.

## Negative tests

- A component renders no control absent from the caller's capability set.
- Accessibility per `docs/COMPONENT_GUIDELINES.md`: full labels, announced errors, keyboard reachable.

## Files and areas

`apps/admin/components/access/` (new), `apps/admin/lib/i18n/en.ts`; `packages/ui/` only if a control changes.

## Migration

None.

## Gates

V, B (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: batch 2 (shared patterns).

## Out of scope

The screens (098 to 103). The timing proof at 1,000 accounts (105).
