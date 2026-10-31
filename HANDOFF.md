HANDOFF: INTERRUPTED

# 083 D0 to D9: what is on this branch and what is not

The 2026-11-01 rulings recorded in `docs/features/083-agent-actions-every-screen.md` and in
SEC-17 are built, D1's `apply-draft` included. Nothing is waiting on a ruling.

**D9 is out of scope** (Code Owner, 2026-11-01). A self-service account act holds no matrix
cell and acts in no environment, so it is no action kind and the Settings screen carries
none; criterion 3 stays verbatim. The work order and SEC-17 both record it.

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

**The cross-screen seam is in.** `apps/admin/lib/agent/waiting.tsx` is the context the card
publishes to and every heading row reads;
`apps/admin/components/agent/heading-marker.tsx` is the wrapper a screen puts round the
control a kind's descriptor names, and the marker shows on that control alone while the
card is in the Proposed state. The same context carries a hand-off: Confirm on a hand-off
step reaches that screen's own control with the non-secret arguments filled, which is what
`response.export` uses to open the export dialog on the card's own filters.

**The create variant is in** (Code Owner, 2026-11-01). `form.create`, `question.create` and
`question.newVersion` each call a non-redirecting variant of the screen's own action: the
same validation, the same route and so the same grant check, the same audit row, and the
new id or version returned as the one allowlisted field a later step may reference.

**The read tools of D1 to D7 are in.** `apps/api/src/features/agent/contexts/reads.ts`
holds one port per tool, each re-making its own screen's read check.

**`apply-draft` is in** (Code Owner, 2026-11-01). `propose_draft` records and validates a
draft and saves nothing; the model then proposes `apply-draft`, whose step carries the
draft, the questions it invents and both advisory lists. It reaches no route, so it carries
no token, and a plan's token now binds only the steps that do - which is what lets it be a
plan's first step without shifting any later step's provenance check. The builder screen
runs the same conversation every other screen runs, so one card renderer serves them all;
`AssistPanel`, its strings and its CSS are retired, and its step timeline, reasoning
disclosure and per-code error sentences moved into the shared conversation, where every
screen now has them.

## Gates on this head

`pnpm qcms:sync-templates` clean, `pnpm check:all` exit 0, `pnpm verify` exit 0.
`pnpm exec turbo run test --force` ran three times, 20/20 tasks and 0 cached each time, and
each run failed only on container-start or boot timeouts (issue #1201's load flake) in a
different file: run 1 `agent/provenance.integration` and `auth/auth.integration`, run 2
`agent/assist.integration`, run 3 `releases/releases.integration` and
`responses/start-session/environment-addresses.integration`. Five distinct files, each red
once and green in the other two runs, never an assertion. Not re-run to green.

## Not started, for the next round

- **`QCMS_PORT_SEAT=7 pnpm up:e2e`, `pnpm exec vitest run --project qcms-api-e2e` and the
  full browser suite have not been run on this head.**
- **`apps/admin/e2e/agent-assist.pw.ts` has been ported by locator** (the panel's test ids
  to the dock's and the card's, the step count from two to three) but **has not been run**:
  the full browser suite did not fit in this round's budget. Run it first, before anything
  else here.
- **Criterion 11's Playwright matrix** (a confirm path alone and inside a plan, a cancel
  path, and axe over all eight card states, per kind), the read tools' own browser
  coverage, and an `apply-draft` row in that matrix: a confirm inside a plan whose first
  step is the draft, and axe over the card with a diff and both advisory lists open.
- **Criterion 13's** rehearsal of 038's goal 7.
- **The records "The records this task closes" names**: ADR-25's and SEC-17's status lines
  still read "decided, not built", `docs/agent-authoring.md` section 4 is not rewritten,
  `docs/SECURITY_DESIGN.md` section 8's four-tool paragraph is not retired, 038's header
  still lists 080 to 083, the four work orders are still in `docs/features/`, and the
  ledger rows are still open. They close when the remaining criteria do.

## Discoveries worth a ruling, neither of them blocking

- **The conversation's own error reporting was widened rather than narrowed.** The retired
  panel resolved each failure to its own sentence and the shipped screen conversation
  reported one generic line, so the shared conversation now uses the panel's resolver on
  every screen (`apps/admin/lib/forms/assist-errors.ts`). That is more copy on more screens
  than any ruling asked for; it is the alternative to the builder losing what it had.
- **The card's quoted reason is the turn's closing prose segment**, which is what the panel
  quoted, rather than the whole turn's text the screen conversation was clamping.
