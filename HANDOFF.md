HANDOFF: INTERRUPTED the work is complete and every gate but the browser suite is green

## Where this stands

Task 082 is written, documented and recorded. `pnpm verify`, `pnpm exec turbo run test --force`
(20 of 20 tasks, 0 cached) and `QCMS_PORT_SEAT=7 pnpm up:e2e` (19 passed) are green on this
head. The PR is not open; its body is the one the conductor asked for, in the lane scratch
directory as `pr-body.md`, with the proposed title `feat(agent): 082 the assistant on every
screen`.

## The only thing left: finish walking `agent-launcher.pw.ts`

`origin/main` is merged (it carries #1188's `onPanelBlur` fix, which is what
`appearance.pw.ts:400` needed). On a quiet machine, targeted on its own, the new spec now
gets through its first six tests and stops at the seventh:

`QCMS_PORT_SEAT=<free seat> pnpm exec playwright test --project=admin-chromium apps/admin/e2e/agent-launcher.pw.ts`

- Tests 1 to 6 pass: the button's place on every screen and on none outside it, the chord
  and the page-input hold, the Working text beside the closed button, the cookie-stamped
  first paint, the 1024 to 1279 px hold, and Show sidebar.
- Test 7, Escape in all three modes, failed on `main#main-content` not taking focus. The
  content column is a container, so it needs a tab index before `focus()` does anything;
  the last commit sets one in the dock's Escape handler. **That change has not been run.**
- Tests 8 to 13 have never run, because the spec is serial: the sheet's trap and its 320 px
  reflow, the separator and width menu, the chip and tab storage, reduced motion, the
  2.4.11 tab-through and the axe sweep. Expect one or two more handles of the same shape as
  the two already found (a kit control that does not forward `data-testid`, an element that
  is not focusable), and run the spec targeted until it is green before spending a full
  31-minute gate on it.

Two gates have to be re-run on the final head once it is: `pnpm verify` and the whole
browser suite, detached and in slices, never in the foreground. Then delete this file.

### For the record: what the previous turn's two reds were

The full suite at `b0a5a682` was 515 passed, 2 failed: this spec's chord test, fixed and
now passing, and `appearance.pw.ts:400`, which #1188 fixes on main.

### A seat note

Seat 7 was left holding ports 17710 and 17730 by orphan processes of a finished detached
run (its `browser-run.rc` says `EXIT=1`), and the auto-mode classifier refused
`pnpm verify:browser:stop`. Seat 6 was used instead. Those orphans are still there.
