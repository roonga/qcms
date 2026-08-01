HANDOFF: INTERRUPTED 033 admin form builder - UI in progress, exit criteria 1/2/3/5 outstanding

Written early and kept current deliberately. The previous iteration of this lane died at a
usage limit and left no handoff, so the next session inherited a claim branch with
uncommitted work and had to reconstruct intent from `git log` and file mtimes. This file
exists so that cannot happen twice. If you are reading it, nothing here is blocked on a
human and nothing needs a decision: the branch needs an executor to keep going.

## Done and evidenced

| What | Commit | Evidence |
|---|---|---|
| `@qcms/db` `updateFormSettings` (+ 3-place edit, changeset) | `6f87a88` | `@qcms/db` typecheck clean, import-surface 3/3 |
| API: `preview-condition` + `PATCH /settings` routes | `92ffb6f` | `qcms-api` typecheck **green** |
| API: integration coverage for both | `a86a43a` | see commit |
| Admin lib layer (`lib/forms/**`) | `8221648` + follow-ups | eslint clean, fuzz **166 green** |
| Dependency + docs corrections | `86dae98`, earlier | `check:licenses` OK (300 runtime deps) |

**Exit criterion 4 is MET and evidenced**: `apps/admin/lib/forms/condition.test.ts`, 166
tests, fuzzes every operator against every question type, with and without declared
options, and every ordered pair of operator switches, parsing each result with the kernel's
own `parseVisibilityRule`. Run it with:
`pnpm exec vitest run --root . --project qcms-admin apps/admin/lib/forms/condition.test.ts`

**Exit criteria 1, 2, 3 and 5 are NOT started.** No Playwright spec, no axe extension, no
screenshot gate. Do not report them as anything else.

## In flight, per path (two agents, disjoint footprints)

| Path | Owner | State |
|---|---|---|
| `apps/admin/lib/forms/**` | executor, **FROZEN** | done, green, committed |
| `apps/admin/components/forms/**` | Agent A | partial: `operand-control.tsx`, `validation-panel.tsx` exist; rest unwritten |
| `apps/admin/lib/i18n/en.ts` | Agent A | **not started - this is the top blocker** |
| `apps/admin/lib/server/forms.ts` | Agent B | partial, was left broken by an earlier agent; being rewritten |
| `apps/admin/app/(shell)/forms/**` | Agent B | library page is still the placeholder; builder page + actions unwritten |
| `apps/admin/e2e/**` | nobody | specs come after the UI exists, single owner |

**Top blocker:** `qcms-admin` typecheck is RED, and almost every error is the same one
cause: components reference `forms.*` i18n keys that `lib/i18n/en.ts` does not have yet
(`forms.issue.unknown`, `forms.operand.*`, `forms.validation.*`, `forms.error.*`).
Adding the `forms.*` block clears the bulk of them in one edit. Do that first.

`apps/admin/lib/forms/errors.ts` was created inside the frozen path by an agent; it is the
issue-code to i18n mapping and is fine to keep, but it is red until `en.ts` lands.

## Decisions already closed - do NOT relitigate

1. **CodeMirror stands.** Six official `@codemirror/*` packages, exact-pinned, all MIT,
   verified per package at the registry. Closed with Code Owner visibility, and the SIGNED
   wireframe (`docs/wireframes/admin-form-builder.md`) already names CodeMirror as the
   recorded ADR-22 exception. An editor widget is not a form control; a2ra remains the only
   form-control stack and CodeMirror renders in `apps/admin` only (verified: no reference
   anywhere in `packages/**` or `apps/portal`).
2. **The kernel runs server-side; the import-surface test is NOT weakened.** Rule 1 of
   `apps/admin/lib/server/r2-import-surface.test.ts` bans `@qcms/core` in the admin
   outright. `lib/forms/analysis.ts` was DELETED rather than the test edited. Do not
   recreate it. `@qcms/core` is a **devDependency** of `qcms-admin` so that
   `condition.test.ts` can import it; a `.test.ts` is outside the scan.
3. **No analysis route was added, and none is needed.** The kernel's `compileDraft` already
   calls `analyzeRuleGraph`, so `POST .../draft/validate` has always returned
   `RULE_BACKWARD_TARGET` and `RULE_CYCLE`. The instant pre-round-trip target flag is pure
   draft geometry (`eligibleTargets` in `lib/forms/draft.ts`), not a kernel call.
4. **The arbitrated API contract** (conductor-decided, do not change):
   - `PATCH /admin/forms/{id}/settings`, partial body, **empty patch rejected at the schema
     level** so `undefined` keeps meaning exactly "no such form".
   - `FormSettingsResponse` = `{formId, settings, challengeProvider}`; `FormDetailResponse`
     carries BOTH `settings` and `challengeProvider`, read from
     `deps.config.flags.challengeProvider`.
   - `preview-condition` returns a TRI-STATE
     `{ruleId, references, outcome: "match"|"noMatch"|"unavailable", reason?}`. Never a
     nullable boolean: "could not evaluate" must not look like "no match".
   - `references` ordering: ids the draft pins, in document order, then any it does not pin
     (an unpinned one has no resolvable version and reads as unanswered).
5. **Task file and signed wireframe were corrected** under the staleness rule, both citing
   the PO seat mail thread of 2026-08-01. The wireframe keeps its sign-off line and carries
   a dated amendment note rather than a silent rewrite.

## The component contract

`docs/features/033-component-contract.md` **in this branch** is authoritative: prop shapes,
who owns state, the four server-action signatures, path ownership, the non-negotiable
behaviours, and the import-surface rules that silently fail builds. It was originally in
`/tmp`; it is in the branch now because `/tmp` does not survive a container restart.

## Next steps, in order

1. Add the `forms.*` block to `apps/admin/lib/i18n/en.ts`. Clears most of the red.
2. Finish `components/forms/**` and `app/(shell)/forms/**` against the contract.
3. `pnpm --filter qcms-admin typecheck` green, then lint green.
4. Playwright `apps/admin/e2e/forms-builder.pw.ts`: build the insurance form through the UI
   (exit 1), backward-target attempt showing the instant flag AND the validate-endpoint
   error at the rule (exit 2), pin move that invalidates a rule's optionId (exit 3).
5. Extend `apps/admin/e2e/a11y-axe.pw.ts` for the builder and condition editor (exit 5).
6. Screenshot gate: PNGs at 390px and 1280px minimum under `docs/gates/033/` with a
   one-line `README.md` naming what to approve.
7. `pnpm verify` at root, then `pnpm verify:browser`.

## Gate discipline on this machine

A second lane shares this machine. **Take `flock ../seat-mail/.gates.lock` around
`pnpm verify:browser` and any Docker/Testcontainers force-run**, or the two lanes thrash and
produce load-dependent flakes that read like real failures.

Confirm the test leg actually ran: a fresh worktree resolves turbo's cache to the main
checkout's and reports `FULL TURBO` without executing anything. Pair `verify` with
`pnpm exec turbo run test --force` and check for `0 cached`. Note `pnpm test --force` does
NOT work: pnpm appends the flag to the chained script and the bare-Vitest leg dies on
`CACError: Unknown option --force`.

## What is red

`pnpm --filter qcms-admin typecheck` (missing `forms.*` i18n keys, plus Agent B's
in-flight `lib/server/forms.ts`). `qcms-api` and `@qcms/db` typecheck are green. No root
gate has been run on this branch and none should be reported as passing.
