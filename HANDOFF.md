HANDOFF: INTERRUPTED the work is complete and every gate but the browser suite is green

## Where this stands

Task 082 is written, documented and recorded. `pnpm verify`, `pnpm exec turbo run test --force`
(20 of 20 tasks, 0 cached) and `QCMS_PORT_SEAT=7 pnpm up:e2e` (19 passed) are green on this
head. The PR is not open; its body is the one the conductor asked for, in the lane scratch
directory as `pr-body.md`, with the proposed title `feat(agent): 082 the assistant on every
screen`.

## The only thing left: two reds in the browser suite

Two tests fail in a full `verify:browser` run and nothing else does. Both were reproduced
three times, and every run carried the cross-lane contention report (issue #395): another
lane was on the machine throughout, so neither red has had a clean-machine verdict yet.

1. `apps/admin/e2e/agent-launcher.pw.ts:186`, the `Alt+Shift+A` test. The chord half passes;
   the failure is the second half, which needs a text input the PAGE owns so the chord can be
   shown to be ignored while one has focus. `/forms/new` has no text box under
   `main#main-content`, and the last commit moved that step to the question library's rail
   filter instead. **That change has not been run.** Run the spec alone first:
   `QCMS_PORT_SEAT=7 pnpm exec playwright test --project=admin-chromium apps/admin/e2e/agent-launcher.pw.ts`.
   The spec is serial, so this test failing skips the eleven after it; those eleven have
   never run to completion and are the ones that still need a green.
2. `apps/admin/e2e/appearance.pw.ts:400`, "the panel is reachable, navigable and dismissable
   from the keyboard alone". It fails only in a full run and **passes 19 of 19 in isolation on
   this tree**, so it is ordering or contention rather than a property of the change. Its two
   failure shapes are "exactly one radio is tabbable" reading 0 and the high-contrast switch
   detaching from the DOM while a `focus()` retries, which are both the appearance panel
   remounting under the test.

   What was ruled out: an unstable sidebar control. `SidebarProvider` now memoises its control
   and gives `hold` a stable identity, because the assistant's rail-hold effect lists `hold`
   in its dependencies and the provider wraps the whole shell since this task; that was a real
   render loop and it is fixed, and the test still fails in a full run. Swapping the trailing
   group's order back (the appearance toggle before the assistant button) does not change it,
   so the order is not the cause either.

   If it turns out to be the hoisted provider rather than contention, the repository already
   has the answer for this shape of problem: `lib/agent/builder-assist-bridge.ts` shares state
   between two client trees through a module and `useSyncExternalStore` rather than a context
   wrapping both. Moving the assistant's control to that pattern would let the top bar's button
   and the body's panel share state with no provider above the header at all, and the hoist in
   `app/(shell)/layout.tsx` would come back out.

## Then

Re-run the whole gate on the final head, detached and in slices, never in the foreground:
`QCMS_PORT_SEAT=7 pnpm verify:browser:detached`, then
`pnpm verify:browser:wait <dir>` while it exits 75. Open the PR from `pr-body.md` and delete
this file.
