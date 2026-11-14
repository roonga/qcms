# 115 - Builder create card, card-less edits, Undo and the wizard diff

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin`, `apps/api` (create kind) · **Depends on:** 113, 112; the create card, edit and Undo states on the Agent Builder design canvas seen by the Code Owner
**References:** `plan/agent-builder-decisions.md` (U7, Q13, Q14, Q15, Q16, Q22, "Required tests": Authorisation) · SEC-17 · `docs/form-publishing-flow.md` · `plan/work-order-sequence.md`

## Context

The builder's write experience. Creating a form is the one Confirm card (the slug is permanent); every later draft edit applies without a card, with Undo, and the publish wizard shows what the agent changed since a human last reviewed the draft.

## Deliverables

- Form creation from `/forms/new/build`: a Confirm card showing the workspace and the slug; needs Edit forms in that workspace; the form and its first draft are created at Confirm, never when the builder opens; until then Share preview and Publish are off. After Confirm the route becomes `/forms/<id>/build`.
- Draft edits applied as 111's token-bound edits, browser-executed, with no per-edit card; each edit shows in the conversation with an Undo control. A new or edited library question is a Confirm card with no Undo control (Q22).
- Undo for the latest edit and earlier ones in reverse order, through 111's Undo route.
- The publish wizard shows the cumulative agent diff since the last human-reviewed revision (111's read) when entered from the builder or when the draft carries agent edits.
- Strings in `apps/admin/lib/i18n/en.ts`.

## Exit criteria

Spec criteria owned: none.

- Abandoning `/forms/new/build` before Confirm leaves no form, draft or audit row.

## Required tests

- Authorisation (X3, U7): create refused without Edit forms in the chosen workspace; a disabled account refused at Confirm; an edit after the account is disabled refused.
- Lazy create: no form row exists before Confirm; one form and one draft after.
- Playwright (X3): create through the card, three edits with no card, Undo twice, the wizard shows the diff and returns to `/build` through `returnTo`; axe clean.

## Files and areas

`apps/admin/app/(shell)/forms/new/build/`, `apps/admin/app/(shell)/forms/[formId]/build/`, `apps/admin/components/agent/{action-card,card-dialog,assistant-conversation}.tsx`, `apps/admin/components/forms/publish-wizard.tsx`, `apps/admin/lib/agent/runner.ts`, `apps/admin/lib/forms/assist-diff.ts`, `apps/api/src/features/agent/actions/forms.ts` (create kind), `apps/admin/lib/i18n/en.ts`, `apps/admin/e2e/`.

## Migration

None.

## Gates

V, B (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: the create card, an applied edit with Undo and the wizard diff on the Agent Builder canvas, seen by the Code Owner before dispatch.

## Out of scope

Appearance edits through the drawer (116) and theme kinds (117).
