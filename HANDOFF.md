HANDOFF: AWAITING-HUMAN three rulings on 083 D1 to D9, listed below, before the remaining screen groups can be wired

# 083 D1 to D9: what is on this branch and what is not

## Landed

| Deliverable | Kinds wired end to end                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| D0          | the token, provenance, the audit table, the grant filter, the propose tools, the card and plan card, the runner         |
| D1          | `form.settings`, `form.close`, `form.reopen`                                                                            |
| D2          | `form.release`, including a promotion that names its own destination                                                    |
| D3          | `link.mint`, `link.revoke` (D0's, unchanged)                                                                            |
| D4          | `response.erase`, `response.unflag`                                                                                     |
| D5          | `webhook.create`, `webhook.rotate`, `webhook.retarget`, `webhook.reactivate`, `webhook.deactivate`, `webhook.redeliver` |

Each kind carries its descriptor, its catalog card templates, the trailing
proposal argument on the screen's own server action, the audit call in the
handler it reaches, a `propose-<kind>` fake script and unit coverage.

## Blocked on a ruling

1. **`form.publish` and the publish wizard.** The merged wizard (PR #1200)
   removed the admin's client for `POST /admin/forms/{id}/publish` and publishes
   through `publish-batch`, whose route policy takes its environment from
   `targets`. `provenance-mount.ts` refuses a `targets` row by design, so the
   wizard's route cannot carry a step, and the legacy single-publish route has
   no `expectedWorkflowRevision` check, so a card driving it would be weaker
   than the screen's own dialog. D1's publish and publish-and-release and D2's
   "publish the draft from the versions screen" wait on a choice between making
   a `targets` route proposable per destination, accepting the legacy route for
   the card, or dropping publish from the proposable set until the wizard grows
   a per-step seam. `form.publish` stays in the registry as D0 shipped it and
   has no runner, so a confirmed publish step reports that the control is not
   wired rather than doing something unexpected.
2. **The export kind.** D4's export is a `GET` download the browser performs, so
   it can carry neither of the two headers and cannot be verified in D0's
   shape. Treating it as a hand-off would make it last-only and give it no
   `control.agent_actions` row, which criterion 7 does not obviously allow for a
   non-secret step. The act is already audited as a SEC-15 export row.
3. **Redeliver all.** D5's "redeliver one or all" has no single route for "all":
   the screen loops. It fits as a plan of `webhook.redeliver` steps, which the
   25-step cap bounds, rather than as a kind.

## Not started

- **D6** question library and question detail, **D7** forms list and new form,
  **D8** workspace administration and the agent audit surface, **D9** settings
  hand-offs.
- **The read tools of D1 to D9** (the rule test, the version diffs, the link
  count, the response list and count, delivery status, dead-letter count,
  library search, form search). Each needs a context port on its screen, an
  output schema and a place in the vocabulary sentinel walk.
- **The proposal marker's placement.** `components/agent/proposal-marker.tsx`
  exists and is unit-tested but is mounted on no screen. It needs the waiting
  card published to the shared assistant context so a heading-row control can
  read it, which is one seam shared by every group rather than nine.
- **Criterion 11's Playwright matrix** (a confirm path alone and inside a plan,
  a cancel path and axe over all eight states, per kind) and criterion 13's
  rehearsal of 038's goal 7.
