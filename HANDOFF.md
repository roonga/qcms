HANDOFF: INTERRUPTED

# 083 D0 to D9: what is on this branch and what is not

The 2026-11-01 rulings recorded in `docs/features/083-agent-actions-every-screen.md` and in
SEC-17 are built. Nothing below is waiting on a decision.

**D9 is out of scope** (Code Owner, 2026-11-01). A self-service account act holds no matrix
cell and acts in no environment, so it is no action kind and the Settings screen carries
none; criterion 3 stays verbatim. The work order and SEC-17 both record it.

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
- **D1's `apply-draft` kind**: today's proposal panel as a kind, with Accept running through
  the builder's own save and the sticky `agentAssisted` mark.
- **The read tools of D1 to D8** (the rule test, the version diffs, the link count, the
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
  rows are still open. They close when D6 and D7 do.
