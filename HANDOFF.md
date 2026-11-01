HANDOFF: INTERRUPTED the Operations-only screen move is in progress and the branch is red

Issue #1204, the Code Owner ruling of 2026-11-02: every per-form operational screen lives
only under Operations, in the selected environment, and the form editor keeps authoring.
This branch carries the move itself; what is left is the route registries and the tests
that enumerate them. Continue here rather than starting again: nothing below is a design
question, and the mapping is settled.

## What is on this branch

- The routes moved, with the old addresses kept as redirects that preserve the query:
  - `/forms/{formId}/responses` to `/operations/forms/{formId}/responses`
  - `/forms/{formId}/responses/{sessionId}` to `/operations/forms/{formId}/responses/{sessionId}`
  - `/forms/{formId}/links` to `/operations/forms/{formId}/links`
  - `/forms/{formId}/webhooks` to `/operations/forms/{formId}/webhooks`
  - `/forms/{formId}/export` to `/operations/forms/{formId}/export` (308, so the method survives)
- `apps/admin/lib/ops/moved-contexts.ts` holds the redirect arithmetic.
- The rail: `apps/admin/components/ops/operations-form-rail.tsx` and the slots under
  `app/(shell)/@rail/operations/forms/[formId]/`. Links, Responses and Webhooks left
  `apps/admin/lib/forms/subtree-rail.ts`, which is the editor's rail.
- `apps/admin/lib/ops/form-contexts.ts` offers the three operational contexts and nothing
  authoring, so an Operations row opens the context directly.
- The agent screen ids moved in both tables, and `offerableActionKinds` splits the one form
  subtree into the editor's kinds and the Operations kinds.
- `lib/measure.ts` and `lib/page-title.test.ts` carry the redirect routes.
- Typecheck is green for `qcms-admin` and `qcms-api`.

## What is left, each mechanical

1. `apps/admin/lib/rail-routes.test.ts`: `formScopedScreens()` has to become two sets, the
   editor's and Operations', and `CURRENT_SECTION` has to read the new slots, which say
   `current="links"` rather than `current={{ kind: "section", section: "links" }}`.
2. `apps/admin/lib/route-registration.test.ts`: the six places now include the four
   redirect routes; the failure prints one line per route and place with the entry it wants.
3. `apps/admin/lib/save-model.test.ts`: classify the four redirect routes.
4. `apps/admin/app/(shell)/section-headings.test.tsx` and `operations-states.test.tsx`: the
   moved route paths and the `/operations/forms/...` hrefs.
5. `apps/admin/lib/agent/{context-chip,screen-filters,screens}.test.ts` and
   `components/agent/action-card.test.tsx`: expectations that name a moved screen.
6. `apps/admin/lib/forms/subtree-rail.test.ts` and
   `components/forms/form-subtree-rail.test.tsx`: the editor's rail is five rows now, and
   the tests still describe eight.
7. `apps/api/src/features/agent/screens.test.ts`: the subtree split, and the
   `agent-cards-*.pw.ts` specs for the moved screens.
8. Playwright: the journey the ruling asks for, an account with the response read grant
   opening Operations in `test`, a form's responses, then one response.
9. Then the gates in sequence, and the template mirror.

## Not started, and not design questions either

- **Intake close and reopen as an operational act.** The ruling places it under Operations.
  `form.close` and `form.reopen` are the builder's kinds today and there is no per-form
  Operations screen to host them, so this needs the one screen Q87 calls Overview:
  `/operations/forms/{formId}`, carrying what the selected environment serves, its intake
  and the two acts, plus a row in both agent tables with its own facts and context builder.
- **Warn before leaving Operations** (Code Owner, 2026-11-02), its own branch.
- **The workspace area's rail entries as screens** (Code Owner, 2026-11-02), its own branch
  after phase 6, as that ruling allows.

## Suggestion, not a ruling

The leave-Operations warning will be met on every hop out of the mode. An "always leave"
or "do not ask again" choice was deliberately not added. If operators ask for one, it is a
preference rather than a safety control and belongs with the appearance settings.
