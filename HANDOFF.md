HANDOFF: INTERRUPTED

# 083 D0 to D9: what is on this branch and what is not

The three rulings the previous lane was waiting on arrived (Code Owner, 2026-11-01) and are
recorded in `docs/features/083-agent-actions-every-screen.md` and in SEC-17. Everything
they unblocked is built. What remains is the screen groups and the cross-screen seams
listed below; nothing there is waiting on a decision except the two cases named at the end.

## Landed

| Deliverable | Kinds wired end to end                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| D0          | the token, provenance, the audit table, the grant filter, the propose tools, the card and plan card, the runner         |
| D1          | `form.settings`, `form.close`, `form.reopen`, `form.publish`                                                            |
| D2          | `form.release`, including a promotion that names its own destination                                                    |
| D3          | `link.mint`, `link.revoke`                                                                                              |
| D4          | `response.erase`, `response.unflag`                                                                                     |
| D5          | `webhook.create`, `webhook.rotate`, `webhook.retarget`, `webhook.reactivate`, `webhook.deactivate`, `webhook.redeliver` |
| D8 (writes) | `access.groupCreate`, `access.groupRemove`, `access.grant`, `access.revoke`, `member.role`, `workspace.settings`        |

Each kind carries its descriptor, its catalog card templates, the trailing proposal
argument on the screen's own server action, the audit call in the handler it reaches, a
`propose-<kind>` fake script and unit coverage.

`form.publish` now runs the Publish wizard's `publish-batch` route and freezes the draft
into one destination, so the card keeps that route's stale-review and workflow-revision
checks; the provenance check accepts a `targets`-sourced policy row only for a single
destination equal to the step's environment. `plan-three` publishes into `test` and
promotes that version to `prod`, which runs end to end over the three real routes in
`provenance.integration.test.ts`.

## Not started

- **D6** question library and question detail, **D7** forms list and new form, **D9**
  settings hand-offs, and **D8's read half**: the agent audit surfaced beside the access
  audit on `workspaces/[workspaceId]`.
- **The read tools of D1 to D9** (the rule test, the version diffs, the link count, the
  response list and count, delivery status, dead-letter count, library search, form
  search). Each needs a context port on its screen, an output schema and a place in the
  vocabulary sentinel walk.
- **The two cross-screen seams, which are one piece of work rather than nine.** The panel
  has to publish the waiting card to a context every screen's heading row can read, and
  every screen's heading row has to be able to take focus and a filled field from it.
  Until that exists:
  - **the proposal marker** (`apps/admin/components/agent/proposal-marker.tsx`) is
    unit-tested and mounted on no screen, so criterion 5's marker half is unmet;
  - **the hand-off variant** has its runner half (`apps/admin/lib/agent/runner.ts` calls
    `onHandOff`) and no caller, so no hand-off step opens a screen's own control. D9 is
    entirely hand-offs and cannot land before it, and neither can the response export.
- **The response export kind** (`response.export`), ruled a hand-off step, always last,
  with no `control.agent_actions` row because the export's own SEC-15 row records it. The
  ruling is recorded in the work order and SEC-17; the kind waits on the hand-off seam.
- **Criterion 11's Playwright matrix** (a confirm path alone and inside a plan, a cancel
  path, and axe over all eight card states, per kind) and **criterion 13's** rehearsal of
  038's goal 7.
- **The records "The records this task closes" names**: ADR-25's and SEC-17's status lines
  still read "decided, not built", `docs/agent-authoring.md` section 4 is not rewritten,
  `docs/SECURITY_DESIGN.md` section 8's four-tool paragraph is not retired, 038's header
  still lists 080 to 083, the four work orders are still in `docs/features/`, and the
  ledger rows are still open. They close when D6, D7 and D9 do.

## Needing a ruling before they can be wired

1. **A screen action that redirects.** D7's create a form (`createFormAction`) and D6's
   create a question and open a new version (`createQuestionAction`,
   `lifecycleAction` with `newVersion`) end by calling `redirect()`, which is what the
   screen's own control does. A card step that calls one navigates the page away, so any
   later step of the plan is lost without being reported, which is what "partial execution
   is reported, not hidden" forbids. The choices are to make a redirecting kind terminal
   for a plan the way Pending approval is, to give these acts a non-redirecting variant
   the card calls, or to leave them unproposable until their screen grows a seam. Nothing
   in the work order or the 2026-11-01 rulings settles it.
2. **Two-factor re-enrolment has no control.** D9 names it as a hand-off, but the Settings
   screen offers only the on and off state and the recovery-codes form; that screen's own
   comment records that re-enrolment is a sign-out. By section 1.4 an act with no admin
   screen control is not proposable, so either the screen grows the control or the kind
   drops from D9.
