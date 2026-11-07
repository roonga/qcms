HANDOFF: INTERRUPTED

The omnibus UI branch for #1208 and #1162. Every gate below the browser is green at this head. The
browser gate is down to four failures, all in specs this branch owns, and the PR is not open.

## Green at this head

- `pnpm check:all`: all 24 checks.
- `pnpm exec turbo run lint typecheck test --force --concurrency=4`: 43 of 44 tasks, 0 cached. The
  one red was a Testcontainers port-bind timeout under host load; `qcms-api#test` re-run alone and
  forced is green (109 files, 2387 tests, 0 cached).
- `pnpm qcms:sync-templates` then `pnpm check:templates`: clean.

## The browser gate

Seat 9 is held by another worktree, so both runs took seat 8:
`QCMS_PORT_SEAT=8 QCMS_HARNESS_BUILD=1 pnpm verify:browser:detached`, waited in slices.

The second run: 617 passed, 4 failed, 6 did not run. Fixed since the first run: the builder's axe
target-size, `forms-promotion`, `operations-form-rail` and `responses-ops`.

1. `authoring-environment.pw.ts:45` expects the form rail to carry the form's title ("Authoring in
   prod"); the rail names the form by its slug. Decide which the rail owes, then fix the side that
   is wrong.
2. `authoring-environment.pw.ts:75` expects the publish wizard's shared-draft source to be enabled
   with prod selected; it is disabled. A direct draft publication to prod is refused with
   `TEST_RELEASE_REQUIRED`, so either that refusal is what the wizard is drawing (fix the spec) or
   this is the environment gate the branch removed (fix the wizard).
3. `focus-not-obscured.pw.ts:182`: `/forms/frm_auto_quote` no longer overflows 1440x900, so the
   helper refuses the check. The page action's move onto the breadcrumb row took a row out of the
   screen. Give that check a screen that still scrolls.
4. `operations-forms.pw.ts:28`: the second form the test creates is missing from the Operations
   table. Not diagnosed.

## Also found, not fixed

- A field's help glyph sits at the end of the field rather than 4px after its label, because
  `.qcms-field-help` gives the field the room. The Help card asks for 4px; a help slot in the kit
  field is the fix.
- `.qcms-iconbutton--sm` has one consumer, the copy control.
- The audit's unhoverable help disc did not reproduce: 10 screen and width combinations, every disc
  24 by 24 and hit-testable at its centre. `round-controls.pw.ts` now guards that.

## Next

Fix the four above, re-run the browser gate, then open the PR, not merged and no review requested,
with the title `feat(admin): help pattern, round controls, environment scope and the page header's
actions` and the body drafted at `node scripts/agent-scratch.mjs --path pr-body.md` (lane scratch,
so recreate it from the commits if the directory has been cleared).
