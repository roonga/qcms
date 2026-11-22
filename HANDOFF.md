HANDOFF: INTERRUPTED

Task 117 (theme action kinds and the derive flow). The API half of G2 and the X4 derive
sentinel are committed and green. The admin half (U5), the `form.appearance` path, the
fake-model scripts (G4b), the Playwright journey (X3), the changeset and the ledger row
are not written. The lane ran out of working room, not out of decisions: nothing below
waits on an answer, though two seams deserve a Code Owner line before review.

## What is done

- `apps/api/src/features/agent/actions/themes.ts`: `theme.derive` and `theme.save`.
  - `theme.derive` carries no route, no token and no `url` argument, so no proposal can
    name an address. Its card template names `typedInput: "url"`: the user types the
    address on the card, which shows it in full, and Confirm hands it to the drawer's
    `appearance.derive` control (SEC-18 W2). `parity.test.ts` pins the route its Confirm
    ends at.
  - `theme.save` derives from `WorkspaceThemeBody` and names the theme alone; the look is
    the drawer's live state, unnamed and unbound.
- `ActionCardTemplate.typedInput` in `actions/types.ts`.
- Both kinds in `ACTION_KINDS` and `BUILDER_ACTION_KINDS`; `grant-filter.ts` now offers a
  kind whose own screen is the builder only on the builder.
- `prompts/actions/theme.derive.md` and `theme.save.md`, `prompts.generated.ts`,
  `rendered/`, `SYSTEM_PROMPT_VERSION` 33 and its hash.
- `DerivedThemeFact` in `agent/schema.ts` and in `BUILDER_FACTS`: hex colours, registry
  enums and booleans, no logo key. The corrected colour names itself `role`, because
  `token` is in the vocabulary the fact walk refuses.
- Card copy under `agent.card.theme.*` and `agent.card.typedInput.url*` in
  `apps/admin/lib/i18n/en.ts`.
- Tests: `actions/themes.test.ts` (7) and
  `workspaces/brand-fetcher/derive-sentinel.test.ts` (3).

Gates run on this state: `pnpm exec turbo run typecheck --filter=qcms-api`, the whole
`qcms-api` unit project (1598 passing, integration excluded), `pnpm check:no-em-dash`,
`pnpm check:comments`, prettier over the touched trees, `turbo run lint --filter=qcms-api`.
`pnpm verify`, the forced Docker run and the browser gate have NOT run.

## What remains

1. **U5, the drawer's derive flow.** In `apps/admin/components/forms/appearance-drawer.tsx`,
   below the Theme picker: a `From your website` label, a `type="url"` input with the
   placeholder `https://www.example.org` and a `Get theme` button (the Appearance-Panel
   board draws exactly this, inside the open theme list). A derive adds a theme row marked
   `Not saved`, previewed live, with the 107 correction sentences beneath it, and a
   `Save as workspace theme` button that runs `theme.save`'s route. Reuse
   `contrastFailureSentence`'s shape for the correction copy; the Brand board's wording is
   the model ("One colour moved. The site's green #4caf50 is 2.8:1 on white, too light for
   text and buttons.").
2. **Server seams.** `apps/admin/lib/server/themes.ts` needs `deriveWorkspaceTheme` and
   `createWorkspaceTheme` (POST `/workspaces/{id}/themes/derive` and `/themes`), each
   through `readResult`. New actions in `apps/admin/app/(shell)/forms/actions.ts`. The
   refusal codes `THEME_DERIVE_REFUSED`, `THEME_DERIVE_NOTHING_FOUND`, `THEME_NAME_TAKEN`,
   `INVALID_THEME`, `APPEARANCE_CONTRAST`, `LOGO_UNKNOWN` all need copy, and
   `apps/admin/lib/forms/error-copy.test.ts` sweeps `FORM_CODE_MESSAGES`.
3. **The derived-theme fact.** `derivedThemeFact()` in `apps/admin/lib/agent/builder-facts.ts`
   in the API schema's shape, published through `builder-facts-store.ts` after a derive, with
   a case in `builder-facts.test.ts`. Transport is where task 114 left it: the store holds
   the facts, no turn sends them yet.
4. **The card's URL field.** `card-parts.tsx`/`action-card.tsx` render a field for
   `step.card.typedInput`, show the value in full, keep Confirm off until it is a non-empty
   `https://` address, and pass it into the hand-off fields. `assist-stream.ts` must read
   `typedInput` off the proposal (it already reads `typedConfirmation`), and
   `runner.ts`/`assistant-conversation.tsx` must carry the typed value into
   `requestHandOff`. The drawer then takes it with `useHandOff("appearance.derive")`.
5. **`form.appearance`.** The Appearance board shows the agent's appearance change as a
   card-less edit: "Applied to draft | Undo", with the drawer open beside it. Task 111
   already built the whole route half: `appearance` is in `EDIT_OPS`, `draftStateDigest`
   covers the appearance, and `edit.integration.test.ts` already pins that an `appearance`
   op may change the appearance alone and no other op may touch it. What is missing is the
   tool that mints such an edit. See the first question below.
6. **G4b.** A `system/` section for the three acts, and `fake-model.ts` scripts for each.
   Bump `SYSTEM_PROMPT_VERSION` again and record the generator's hash.
7. **X3.** A Playwright spec deriving against task 110's fixture server
   (`apps/api/e2e/support/brand-fixture-server.ts`), through Confirm, the `Not saved` row,
   the save and the apply, with axe over each state.
8. **Closing.** A changeset, the SECURITY_DESIGN lines for SEC-18 W2 and M3 (they name 117
   as the task that verifies them), ledger row 117, `pnpm qcms:sync-templates`.

## Two seams for the Code Owner

1. **Where `form.appearance` lives.** The work order says the three kinds are "registered in
   `actions/registry.ts`", but it also calls `form.appearance` a draft-scoped edit on 111's
   path with no card, and the Appearance board draws it as "Applied to draft | Undo".
   `tools/edit.ts` says "Appearance is its own drawer and kinds, not a tool here", and
   `BUILDER_EDIT_OPS` holds the four structural ops only. Recommendation: make it a builder
   tool (`edit_appearance`) yielding the existing `appearance` edit op, add that op to
   `BUILDER_EDIT_OPS`, and correct that sentence. A card for an appearance change would
   contradict both the board and the ruling that draft edits auto-apply with an Undo.
2. **The two buttons on workspace Settings.** The Settings-States and Screens-C boards draw
   "Derive from a website" and "Save as workspace theme" on the Settings Appearance panel,
   both marked "Ruled, not yet in the product". The 116 ruling supersedes them: a workspace
   theme is created only from the drawer's "Save as workspace theme", and Settings lists,
   renames and deletes themes and uploads logos. Recommendation: leave Settings as 116 left
   it and drop both buttons from the boards. `themes.create.note` already says a theme is
   saved from the drawer, and step 1 above makes that true.

Also worth a line at review: the Brand board draws the derive card after the fetch (a
proposed theme with Save, Adjust and Cancel), while SEC-18 W2 requires the address on a
Confirm card before anything is fetched. This branch follows W2 and keeps the board's copy
for the post-derive messaging and the `theme.save` card.
