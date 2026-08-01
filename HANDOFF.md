HANDOFF: AWAITING-HUMAN screenshot gate sign-off for 033 - review the PNGs in `docs/gates/033/` from GitHub and approve or reject

The implementation is complete and every gate is green. Nothing is blocked on a decision
and nothing is red. The only thing left is the Code Owner's screenshot review, which is a
human gate by rule and is never simulated.

## Exit criteria, all met

| # | Criterion | Evidence |
|---|---|---|
| 1 | Playwright build-the-insurance-form suite green | `forms-builder.pw.ts:97` green |
| 2 | Backward target: instant flag *and* validate-endpoint error at the rule | `forms-builder.pw.ts:143` green |
| 3 | Pin move re-runs validation and surfaces the broken optionId | `forms-builder.pw.ts:179` green |
| 4 | Editor never emits DSL the schema rejects | `lib/forms/condition.test.ts`, 166 tests, parsed with the kernel's own `parseVisibilityRule` |
| 5 | axe pass on builder and condition editor | `a11y-axe.pw.ts:253` green |

## Gates run on this branch

- `pnpm verify` -> **exit 0**, end to end, including `check:all`, build, typecheck, lint,
  test and golden-drift (65 golden tests).
- `pnpm exec turbo run test --force --concurrency=1` -> **0 cached, 14 total**, 1545 tests
  passing. This is the run that proves the test leg actually executed: a plain `verify` in a
  fresh worktree replays the main checkout's turbo cache and reports `FULL TURBO` having run
  nothing.
- `pnpm verify:browser` -> **152 passed, 18 skipped**. The skips are the three opt-in
  screenshot-capture specs, which only run under `QCMS_ADMIN_CAPTURE_GATE=1`.
- Screenshot gate captured green under that flag (4 specs, light/dark/high-contrast).

## Where the gates have to run on this machine

`pnpm verify` cannot be run from inside `qcms-dev-container`. The tooling Vitest project
includes `scripts/devcontainer.test.ts`, which drives the devcontainer CLI's `stop`/`down`
commands, so the suite stops the very container it is running in and the run dies with exit
137 partway through. Run the gates either with the dev container stopped, or from a
disposable container started from the same image. Two smaller traps in the same territory:
the worktree's `.git` file records a host-absolute gitdir, so a container needs that path
present (a symlink to the mount) plus `git config --global --add safe.directory "*"`; and
the host and the container see the same tree at different absolute paths, so Turbopack's
`.next`/`.next-dev` caches must be cleared when switching between them.

## Decisions already closed - do NOT relitigate

1. **CodeMirror stands.** Six official `@codemirror/*` packages, exact-pinned, all MIT. The
   SIGNED wireframe (`docs/wireframes/admin-form-builder.md`) names CodeMirror as the
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

1. **The steps rail overflowed its grid track.** A grid item's default `min-width: auto` let
   the add-step row push the rail wider than its 16rem track, so the next column's paragraph
   painted over the "Add step" button: visible, enabled, unclickable. Fixed with `min-w-0`
   plus wrapping rows on the rail and `minmax(0,1fr)` tracks in the builder.
2. **A rule with no target is an UNPARSEABLE draft, not an inconsistent one.**
   `VisibilityRule.show` is `.min(1)`, so a rule the author has just added 422s at `PUT
   .../draft`. `unsaveableReason` returns `ruleWithoutTarget` and autosave pauses with a
   sentence instead of showing a failed save until a target is picked.
3. **Bound server actions change identity on every server render**, and a successful save
   calls `revalidatePath`, which causes one. Listing them in the autosave effect's deps is an
   infinite save loop; they are held in a ref instead.
4. Two e2e conventions, both already encoded elsewhere in the suite: a vendored `Select`
   trigger's accessible name is **value then label** (so match a suffix), and a vendored
   `Checkbox` must be clicked by its visible **label**, because react-aria puts a decorative
   indicator over the real input.

## What the human does next

Review the 24 PNGs in `docs/gates/033/` (library, builder, condition editor, backward-target
state, each at 390px and 1280px in light, dark and high contrast) from the PR body, and
approve or reject. On approval this branch is ready for review and merge; nothing further is
needed from an executor.
