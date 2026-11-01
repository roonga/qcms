HANDOFF: INTERRUPTED

# 083 D0 to D9: what is on this branch and what is not

The 2026-11-01 rulings recorded in `docs/features/083-agent-actions-every-screen.md` and in
SEC-17 are built, D1's `apply-draft` included. **D9 is out of scope** (Code Owner,
2026-11-01): a self-service account act holds no matrix cell and acts in no environment, so
it is no action kind and the Settings screen carries none; criterion 3 stays verbatim.

## Landed

| Deliverable | Kinds wired end to end                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| D0          | the token, provenance, the audit table, the grant filter, the propose tools, the card and plan card, the runner         |
| D1          | `apply-draft`, `form.settings`, `form.close`, `form.reopen`, `form.publish`                                             |
| D2          | `form.release`, including a promotion that names its own destination                                                    |
| D3          | `link.mint`, `link.revoke`                                                                                              |
| D4          | `response.erase`, `response.unflag`, `response.export` (a hand-off into the screen's own dialog)                        |
| D5          | `webhook.create`, `webhook.rotate`, `webhook.retarget`, `webhook.reactivate`, `webhook.deactivate`, `webhook.redeliver` |
| D6          | `question.create`, `question.saveDraft`, `question.publish`, `question.deprecate`, `question.newVersion`                |
| D7          | `form.create`                                                                                                           |
| D8 (writes) | `access.groupCreate`, `access.groupRemove`, `access.grant`, `access.revoke`, `member.role`, `workspace.settings`        |
| D8 (read)   | the agent audit beside the access audit on `workspaces/[workspaceId]`, for the same readers                             |

The cross-screen seam, the hand-off, the non-redirecting create variant, the read tools of
D1 to D7 and `apply-draft` are described in the commits that carry them. `AssistPanel`, its
strings and its CSS are retired and the builder screen runs the same conversation every
other screen runs.

## This round

**The builder move is proven in a browser.** `apps/admin/e2e/agent-assist.pw.ts` had been
ported by locator and never run; it now passes 11 of 11 against the production build.
Running it found the defect below.

**Every action card arrived expired, so no Confirm path was reachable.** The composed
browser-harness API runs on `fixedClock(NOW)` (`apps/api/e2e/support/harness.ts`), so a
proposal is issued at `2026-07-20T00:00:00Z` and its ten-minute window closes on that
clock, while the card reads the window against the browser's real wall time.
`apps/admin/e2e/support/agent.ts` pins the page's clock to that same instant and lets it run
on, which is what makes a Confirm reachable at all; it is the seam every spec in criterion
11's matrix will need. `page.clock.install` plus `resume` rather than `setFixedTime`: a
frozen `Date` makes two autosaves stamp the same instant and `waitForSaveAfter` then cannot
tell them apart.

**The reviewer-flagged `index` and `tokenStep` seam is sound, and is now covered.** No call
site reads the card index where the token's step index belongs: every runner in
`apps/admin/components/agent/step-actions.ts` passes `tokenStep` to `proposalRef`, and
`index` is read nowhere outside the runner's own ordering. The plan the ruling names runs
end to end in `apps/admin/components/agent/step-actions.test.ts`
(`[apply-draft, form.publish]`, asserting the local step carries no token and the publish
behind it is sent as the token's step 0), and `apps/admin/lib/agent/runner.test.ts` pins the
numbering itself.

**The launcher's builder-turn spec was still on the retired panel's ids.**
`agent-launcher.pw.ts`'s "carries the builder's turns across the form's subtree" typed into
`qcms-assist-input`, which resolves to nothing now, so the turn was never sent. Ported onto
the dock's composer; that file passes 16 of 16.

### Gates on this head

`pnpm verify` exit 0. The full browser suite ran detached with `QCMS_HARNESS_BUILD=1` on
seat 7: **533 passed, 1 failed, 5 did not run, 19.6 minutes**, the one failure being the
launcher spec above, which passes 16 of 16 on its own after the port. The suite has not been
re-run whole since that port.

`pnpm exec turbo run test --force` ran three times in the previous round, 20 of 20 tasks and
0 cached each time, each run red only on container-start or boot timeouts (issue #1201's
load flake) in a different file and never on an assertion. Not re-run to green.

## Not started, for the next round

- **`QCMS_PORT_SEAT=7 pnpm up:e2e` and `pnpm exec vitest run --project qcms-api-e2e` have
  not been run on this head**, and the full browser suite has not been re-run whole since
  the launcher port.
- **Criterion 11's Playwright matrix.** Nothing of it exists. Per kind: a confirm path alone
  and inside a plan asserting the screen's own state changed and the `control.agent_actions`
  rows exist, a cancel path asserting nothing changed, and axe over proposed, running, done,
  failed, pending approval, not run, cancelled and expired, including `apply-draft`, the
  hand-off, the typed confirmation, the irreversible band and partial execution reported.
  The ingredients are in place: `propose-<kind>` scripts for 26 kinds take their arguments
  from the screen facts the API already sends, so a spec only has to stand on the right
  screen with the right fixtures and send `#qcms-fake:propose-<kind>`;
  `apps/admin/e2e/support/agent.ts` is the clock seam; `openDbHandle` from
  `apps/api/e2e/support/index.js` is how `two-person-rule.pw.ts` reads audit rows. The
  expensive half is the fixture graph (a released version, links, an endpoint, a dead
  letter, a response, a question, a workspace group) and the per-kind "the screen changed"
  assertion. The expired state is reachable by pinning the page clock past the window before
  the turn is sent (`PAST_PROPOSAL_WINDOW_MS`), because the card's state is settled on
  arrival.
- **The read tools' timeline labels and the agent audit panel** have no browser coverage.
- **Criterion 13's** rehearsal of 038's goal 7.
- **The records "The records this task closes" names**: ADR-25's status line
  (`docs/adr/admin.md`), SEC-17's status line, its "Verified by (when built)" list and
  section 8's four-tool paragraph (`docs/SECURITY_DESIGN.md`), `docs/agent-authoring.md`
  section 4, 038's header, moving the four work orders out of `docs/features/`, and the
  ledger rows in `docs/features/README.md`. They close when the remaining criteria do.

## Discoveries worth a ruling, none of them blocking

- **A card's ten-minute window is read against the browser's own wall clock.** The window is
  a server-issued absolute instant and the card compares it with the browser's own now, so a
  client whose clock is more than ten minutes out has every card arrive expired. The API
  stays the authority either way, so this costs no guarantee, but the alternative (count the
  window from the card's arrival in the browser, which is immune to skew) changes a
  control's semantics and is not a choice to make without a ruling. The harness seam above
  is test-only and does not depend on which way it goes.
- **Nothing moves a waiting card to Expired.** `expireCard` in
  `apps/admin/lib/agent/plan-state.ts` is called from tests alone, so the deliverable's
  "Expired - ask again" with Confirm disabled after ten minutes holds only for a card that
  is already past its window when it arrives. The missing half is a tick, and which clock it
  counts on is the ruling above.
- **The conversation's own error reporting was widened rather than narrowed.** The retired
  panel resolved each failure to its own sentence and the shipped screen conversation
  reported one generic line, so the shared conversation now uses the panel's resolver on
  every screen (`apps/admin/lib/forms/assist-errors.ts`). That is more copy on more screens
  than any ruling asked for; it is the alternative to the builder losing what it had.
- **The card's quoted reason is the turn's closing prose segment**, which is what the panel
  quoted, rather than the whole turn's text the screen conversation was clamping.
