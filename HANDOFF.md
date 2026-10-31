HANDOFF: AWAITING-HUMAN rule on whether a self-service account act is an action kind for criterion 3

# 083 D0 to D9: what is on this branch and what is not

The 2026-11-01 rulings recorded in `docs/features/083-agent-actions-every-screen.md` and in
SEC-17 are built where they unblock work. What remains is listed below, and the one thing
that needs a ruling is first because it blocks D9.

## Needing a ruling

**Is a self-service account act an action kind for criterion 3?** D9's three acts (change
password, regenerate recovery codes, sign out) have no matrix cell: every signed-in
administrator holds them on their own Settings screen, gated by the admin session alone.
Criterion 3 reads "a `forms.viewer` is offered no action kind on any screen", and
`grant-filter.test.ts` asserts the whole registry walk returns `[]` for a viewer. A
cell-less kind therefore breaks the criterion verbatim, while gating it on a cell would
refuse an act the viewer can plainly perform by hand. Either the criterion narrows (a
self-service act is not what it counts) or D9's three acts drop from 083 the way two-factor
re-enrolment already has. The branch holds no D9 kind, and the mechanism D9 needs is the
part of the work that is already in: the hand-off seam, and a descriptor whose `route` is
optional for a hand-off.

Nothing else below is waiting on a decision.

## Landed

| Deliverable | Kinds wired end to end                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| D0          | the token, provenance, the audit table, the grant filter, the propose tools, the card and plan card, the runner         |
| D1          | `form.settings`, `form.close`, `form.reopen`, `form.publish`                                                            |
| D2          | `form.release`, including a promotion that names its own destination                                                    |
| D3          | `link.mint`, `link.revoke`                                                                                              |
| D4          | `response.erase`, `response.unflag`, `response.export` (a hand-off into the screen's own dialog)                        |
| D5          | `webhook.create`, `webhook.rotate`, `webhook.retarget`, `webhook.reactivate`, `webhook.deactivate`, `webhook.redeliver` |
| D8 (writes) | `access.groupCreate`, `access.groupRemove`, `access.grant`, `access.revoke`, `member.role`, `workspace.settings`        |

**The cross-screen seam is in.** `apps/admin/lib/agent/waiting.tsx` is the context the panel
publishes the waiting card to and every heading row reads;
`apps/admin/components/agent/heading-marker.tsx` is the wrapper a screen puts round the
control a kind's descriptor names, and the marker shows on that control alone while the card
is in the Proposed state. The same context carries a hand-off: Confirm on a hand-off step
reaches that screen's own control with the non-secret arguments filled, which is what
`response.export` uses to open the export dialog on the card's own filters. Markers are
mounted for D1's publish, intake and settings controls, D2's release, D3's mint, D4's unflag,
erase and export, D5's endpoint panel and dead letters, and D8's access groups, members and
workspace settings.

## Not started

- **D6** question library and question detail, and **D7** forms list and new form, both
  unblocked by the create-variant ruling of 2026-11-01 and neither started.
- **D8's read half**: the agent audit surfaced beside the access audit on
  `workspaces/[workspaceId]`.
- **D9**, blocked above.
- **D1's `apply-draft` kind**: today's proposal panel as a kind, with Accept running through
  the builder's own save and the sticky `agentAssisted` mark.
- **The read tools of D1 to D9** (the rule test, the version diffs, the link count, the
  response list and count, delivery status, dead-letter count, library search, form search).
  Each needs a context port on its screen, an output schema and a place in the vocabulary
  sentinel walk.
- **Criterion 11's Playwright matrix** (a confirm path alone and inside a plan, a cancel
  path, and axe over all eight card states, per kind) and **criterion 13's** rehearsal of
  038's goal 7.
- **The records "The records this task closes" names**: ADR-25's and SEC-17's status lines
  still read "decided, not built", `docs/agent-authoring.md` section 4 is not rewritten,
  `docs/SECURITY_DESIGN.md` section 8's four-tool paragraph is not retired, 038's header
  still lists 080 to 083, the four work orders are still in `docs/features/`, and the ledger
  rows are still open. They close when D6, D7 and D9 do.
