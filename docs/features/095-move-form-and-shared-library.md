# 095 - Move form and the shared question library screen

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `apps/admin` · **Depends on:** 085, 089, 092, 093, 097; design batch 6 seen by the Code Owner
**References:** `docs/WORKSPACE_ACCESS.md` sections 6, 9, 12 and 13 · `plan/workspace-access-implementation.md` (095) · `plan/work-order-sequence.md`

## Context

Moving a form changes who reads its responses, so the move gets the same checks as access and, where the spec says so, a held request. The shared question library API exists; this task adds its screen in Site configuration.

## Deliverables

- **Move form** needs Edit forms in source and destination (route-policy row plus a destination check).
  - Second approval off in the source: performed by a Workspace administrator of the source, or held as a workspace approval request (092 table) until one, or a Site administrator, who is not the mover approves it.
  - Second approval on in the source: every move held until a Workspace administrator of the source or a Site administrator who is not the mover approves it, the mover being one of those included.
  - Re-checked at approval: the mover still holds Edit forms in both workspaces and the destination is not archived. This replaces 085's interim move rule.
  - Refused when the destination is archived.
  - A preview route: who gains and who loses access, from both workspaces' groups, by the same evaluator as access.
  - Audit in both workspaces.
- **Move form screen** on the form rail at two or more workspaces, saying when the move needs an approver and who can approve it.
- **Shared question library screen** in Site configuration (`apps/admin/app/(shell)/site/`), a Site administrator rail row at two or more workspaces and hidden at one, per spec sections 9 and 12. Marking and unmarking write a site audit row mirrored to that workspace; the confirmation states who will see its questions. Question lists show the shared tag.
- No question move screen.
- **Agent kinds:** any move kind follows the held rule; no kind applies a move that the screen would hold.

## Exit criteria

Spec criteria owned: **16, 48, 99, 100, 101, 102, 103, 104, 105, 106, 109**. This task owns those and no others.

- Criterion 48 is proven here for every held kind (self-grant, switch-off, prod-only draft publish from 093, and Move form).
- Criterion 123 (appearance travels by value) is 121's, since appearance is built by 108 and 109.
- Move audited on both sides; the screens match their artboards.

## Negative tests

- Edit forms in the source only is refused.
- Rule off: a move by a non-administrator of the source, a Site administrator who is not a source Workspace administrator included, is not applied until approved; the mover's own and a destination-only administrator's approval are refused; a source Workspace administrator's own move applies.
- Rule on: a source Workspace administrator's move and a Site administrator's move are both held; the mover's own approval is refused.
- A Site administrator who is not the mover approves a held move.
- Approval refused when the mover lost Edit forms in either workspace, or the destination was archived, after the request.
- Shared library mark and unmark each write a site row and a mirrored row.
- An archived destination is refused.
- Responses are readable only through destination groups after the move.
- The preview never names people outside the caller's workspaces.

## Files and areas

`apps/api/src/features/workspaces/{handler,route}.ts`, `apps/api/src/features/membership/route-policy.ts`, `apps/api/src/features/agent/actions/`, `apps/admin/app/(shell)/forms/[formId]/`, `apps/admin/app/(shell)/site/`, `apps/admin/app/(shell)/questions/`, `apps/admin/lib/i18n/en.ts`, `docs/openapi/admin.json`, `apps/api/e2e/security/`.

## Migration

None. Uses 092's table and its `payload` column for the destination workspace.

## Gates

V, D, B, M (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round; Sonnet delta.

## Design gate

Yes: batch 6 (Move form, shared question library) on the canvas and seen by the Code Owner before dispatch.

## Out of scope

Moving questions. Appearance on move (121). The Site configuration shell itself, if 100 has not landed: this task adds only its own rail row.
