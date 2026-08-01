HANDOFF: INTERRUPTED 033 admin form builder - UI complete, gates in progress

Kept current deliberately. If you are reading this, nothing here is blocked on a human
except the screenshot gate (which is a review, not a decision) and nothing needs a
decision: the branch needs an executor to finish running the gates.

## Done and evidenced

| What | Evidence |
|---|---|
| `@qcms/db` `updateFormSettings` (+ 3-place edit, changeset) | `@qcms/db` typecheck clean, import-surface 3/3 |
| API: `preview-condition` + `PATCH /settings` routes and integration coverage | `qcms-api` typecheck green |
| Admin lib layer (`lib/forms/**`) | eslint clean, fuzz **166 green** |
| Admin i18n catalog, pages and actions (`app/(shell)/forms/**`) | `qcms-admin` typecheck green |
| Admin components (`components/forms/**`, all nine) | `qcms-admin` typecheck + eslint green, `next build` green |
| Playwright specs: `e2e/forms-builder.pw.ts`, `e2e/support/forms.ts` | see gates below |
| axe sweep extended for the builder and condition editor | `e2e/a11y-axe.pw.ts` |
| Screenshot gate capture spec | `e2e/gate-screenshots-033.pw.ts`, writes `docs/gates/033/` |

**Exit criterion 4 is MET and evidenced**: `apps/admin/lib/forms/condition.test.ts`, 166
tests, fuzzes every operator against every question type, with and without declared
options, and every ordered pair of operator switches, parsing each result with the kernel's
own `parseVisibilityRule`. Run it with:
`pnpm exec vitest run --root . --project qcms-admin apps/admin/lib/forms/condition.test.ts`

## Decisions already closed - do NOT relitigate

1. **CodeMirror stands.** Six official `@codemirror/*` packages, exact-pinned, all MIT.
   The SIGNED wireframe (`docs/wireframes/admin-form-builder.md`) names CodeMirror as the
   recorded ADR-22 exception. An editor widget is not a form control; a2ra remains the only
   form-control stack and CodeMirror renders in `apps/admin` only.
2. **The kernel runs server-side; the import-surface test is NOT weakened.** Rule 1 of
   `apps/admin/lib/server/r2-import-surface.test.ts` bans `@qcms/core` in the admin
   outright. `lib/forms/analysis.ts` was DELETED rather than the test edited. Do not
   recreate it. `@qcms/core` is a **devDependency** so `condition.test.ts` can import it.
3. **No analysis route, and none is needed.** `compileDraft` already calls
   `analyzeRuleGraph`, so `POST .../draft/validate` returns `RULE_BACKWARD_TARGET` and
   `RULE_CYCLE`. The instant pre-round-trip target flag is `eligibleTargets` in
   `lib/forms/draft.ts`, pure draft geometry.
4. **The arbitrated API contract** (conductor-decided, do not change): `PATCH
   /admin/forms/{id}/settings` with an empty patch rejected at the schema level;
   `FormSettingsResponse = {formId, settings, challengeProvider}`; `preview-condition`
   returns the tri-state `{ruleId, references, outcome, reason?}`, never a nullable boolean;
   `references` in document order for pinned ids, then unpinned.

## The component contract

`docs/features/033-component-contract.md` in this branch is authoritative: prop shapes, who
owns state, the four server-action signatures, and the import-surface rules that silently
fail builds.

## Bugs the browser run found (fixed, keep them fixed)

1. **The steps rail overflowed its grid track.** A grid item's default `min-width: auto`
   let the add-step row push the rail wider than its 16rem track, so the next column's
   paragraph painted over the "Add step" button: visible, enabled, unclickable. Fixed with
   `min-w-0` plus wrapping rows on the rail and `minmax(0,1fr)` tracks in the builder.
2. **A rule with no target is an UNPARSEABLE draft, not an inconsistent one.**
   `VisibilityRule.show` is `.min(1)`, so a rule the author has just added 422s at
   `PUT .../draft`. `unsaveableReason` now returns `ruleWithoutTarget` and autosave pauses
   with a sentence instead of showing a failed save until a target is picked.
3. **Bound server actions change identity on every server render**, and a successful save
   calls `revalidatePath`, which causes one. Listing them in the autosave effect's deps is
   an infinite save loop; they are held in a ref instead.
4. Two e2e conventions, both already encoded elsewhere in the suite and both worth a
   comment where they are used: a vendored `Select` trigger's accessible name is **value
   then label** (so match a suffix, which is what `chooseType`'s `/Type$/` was saying), and
   a vendored `Checkbox` must be clicked by its visible **label**, because react-aria puts a
   decorative indicator over the real input.

## What is left

1. `pnpm exec playwright test --project=admin-chromium forms-builder` green (exit 1, 2, 3).
2. `pnpm exec playwright test --project=admin-chromium a11y-axe` green (exit 5).
3. Capture the screenshot gate and commit the PNGs:
   `QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-033`
   `docs/gates/033/README.md` is already written.
4. `pnpm verify` at root, then `pnpm verify:browser`.

## Gate discipline on this machine

`../seat-mail` does not exist right now, so there is no gate lock to take. Confirm the test
leg actually ran: a fresh worktree resolves turbo's cache to the main checkout's and reports
`FULL TURBO` without executing anything. Pair `verify` with `pnpm exec turbo run test
--force` and check for `0 cached`. `pnpm test --force` does NOT work: pnpm appends the flag
to the chained script and the bare-Vitest leg dies on `CACError: Unknown option --force`.

## What is red

Nothing known. `qcms-admin` typecheck, eslint and `next build` are green; the admin's Vitest
suite is 251/251. No root gate has been run on this branch yet and none should be reported
as passing until it has.
