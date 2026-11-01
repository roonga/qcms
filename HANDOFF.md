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

The card's waiting window is counted from the card's arrival on a monotonic clock, and a
waiting card ticks itself into Expired (Code Owner, 2026-11-01; the ruling is in the work
order and in SEC-17's token paragraph).

## This round

**The window ruling is built.** `apps/admin/lib/agent/plan-state.ts` takes the window's
length from the proposal (`expiresAt - proposedAt`) and `apps/admin/lib/agent/proposal-window.ts`
counts it from arrival on `performance.now()`; `useExpiryTick` arms a timer only while the
card waits and clears it when the card settles or unmounts; the runner's step-0 staleness
guard now reads that monotonic remainder rather than comparing an absolute instant with the
browser's own clock. The API is untouched and stays the authority. `minutesLeft` takes the
remainder rather than an instant, so the footer counts the same window.

`apps/admin/e2e/support/agent.ts` is **kept and repurposed**: the clock install is no longer
what makes a Confirm reachable (arrival semantics made that unconditional), but installing
it is what lets a spec run a window out, and aligning the page clock with the API's pinned
`NOW` is what keeps relative stamps and save stamps reading against the same instant.
`PAST_PROPOSAL_WINDOW_MS` is gone; `runOutProposalWindow` replaced it.

**Criterion 11 has its shared walk and its first screen group.**
`apps/admin/e2e/support/agent-card.ts` is the walk every screen group's spec takes: the
panel, one `#qcms-fake:propose-<kind>` turn, the card's controls and chips, the
`control.agent_actions` rows through `openDbHandle`, and axe scoped to the card. The form
screen takes it first, in `apps/admin/e2e/agent-cards-forms.pw.ts`: `form.close` and
`form.reopen` confirmed alone with the screen's own control flipping and two audit rows, a
cancel that leaves the audit and the screen as they were, and a waiting card run out to
"Expired - ask again" with Confirm disabled. Axe runs on the proposed, done, cancelled and
expired cards. 5 of 5 pass against the production build.

**The read tools' timeline labels and the agent audit panel have browser coverage** in the
same file: `#qcms-fake:read-all` on seven screens asserts each screen's own read-tool
labels and that none falls back to "Working on your request", and the workspace screen's
Assistant actions table is asserted to list the confirmed `form.close` and `form.reopen`
rows against the account that confirmed them.

**Two riders the gates found, both in this task's own area.** The workspace screen's
assistant audit has eight columns, which are wider than that column's measure: a percentage
inline size against the auto-width content column falls back to the table's min-content, so
`measure.pw.ts` measured the screen past the cap issue 657 sets as soon as the audit had
rows. `.qcms-table--wide` is the documented zero plus `min-inline-size` pair for a table
that needs it, and the audit table scrolls instead. Separately, the assistant's conversation
is a scroll container and a turn of prose and step rows holds nothing focusable, so axe
reported `scrollable-region-focusable` on a streaming turn under load; the list is now
focusable and named.

### Gates on this head

`pnpm qcms:sync-templates`, `pnpm check:all` and `pnpm verify` exit 0.
`pnpm exec turbo run test --force` ran four times, 20 of 20 tasks and 0 cached every time,
exit 0 every time, with no container-start flake and no test near its timeout (209s and 207s
on two of the runs). `pnpm exec vitest run --project qcms-api-e2e`: 561 tests in 10 files,
exit 0. `QCMS_PORT_SEAT=7 pnpm up:e2e`: exit 0. The full browser suite ran whole and
detached with `QCMS_HARNESS_BUILD=1` on seat 7: **544 passed, 0 failed, 20.1 minutes**
(19.6 minutes and 533 passing before this round).

## Not started, for the next round

- **The rest of criterion 11's matrix.** The walk and the pattern exist; what is missing is
  the per-screen-group spec for each remaining group, and for each kind the confirm path
  **inside a plan**. The groups and their kinds: the versions and publish screens
  (`form.publish`, `form.release`), the links screen (`link.mint`, `link.revoke`, and
  `plan-fails-at-2`, which is how the Failed and Not run states are reached), the responses
  screens (`response.erase` with its typed confirmation and its card-level irreversible
  band, `response.unflag`, `response.export` as a hand-off), the webhooks screen (six
  kinds, and `plan-pending-at-1` for Pending approval), the questions screens (five kinds),
  the forms list (`form.create`), the workspace screen (six kinds), and `apply-draft` on
  the builder. `propose-<kind>` exists for all 26; the expensive half is still the fixture
  graph (a released version, links, an endpoint, a dead letter, a response, a question, a
  workspace group) and each kind's own "the screen changed" assertion.
- **Criterion 13's** rehearsal of 038's goal 7.
- **The records "The records this task closes" names**: ADR-25's status line
  (`docs/adr/admin.md`), SEC-17's status line, its "Verified by (when built)" list and
  section 8's four-tool paragraph (`docs/SECURITY_DESIGN.md`), `docs/agent-authoring.md`
  section 4, 038's header, moving the four work orders out of `docs/features/`, and the
  ledger rows in `docs/features/README.md`. They close when the remaining criteria do.

## Discoveries worth a ruling, none of them blocking

- **The two riders above were each a defect only data or load could show.** The audit table
  overflowed only once a confirmed act existed, and the conversation's scroll region only
  once a turn was long enough at the moment axe ran. Both are worth remembering when the
  rest of criterion 11's matrix starts writing rows on every screen: a table that fits
  today may not fit the first time it has ten rows.
- **The conversation's own error reporting was widened rather than narrowed.** The retired
  panel resolved each failure to its own sentence and the shipped screen conversation
  reported one generic line, so the shared conversation now uses the panel's resolver on
  every screen (`apps/admin/lib/forms/assist-errors.ts`). That is more copy on more screens
  than any ruling asked for; it is the alternative to the builder losing what it had.
- **The card's quoted reason is the turn's closing prose segment**, which is what the panel
  quoted, rather than the whole turn's text the screen conversation was clamping.
