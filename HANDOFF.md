HANDOFF: AWAITING-HUMAN rule on where `apply-draft`'s two advisory lists arrive and which panel the builder screen renders

# 083 D0 to D9: what is on this branch and what is not

The 2026-11-01 rulings recorded in `docs/features/083-agent-actions-every-screen.md` and in
SEC-17 are built. One thing needs a ruling and is first, because it blocks D1's last kind.

**D9 is out of scope** (Code Owner, 2026-11-01). A self-service account act holds no matrix
cell and acts in no environment, so it is no action kind and the Settings screen carries
none; criterion 3 stays verbatim. The work order and SEC-17 both record it.

## Needing a ruling

**`apply-draft` cannot be built without two decisions the work order does not reach.**

1. **Where do its two advisory lists come from on the wire?** The card is written from the
   kind, its arguments and the catalog, and the `action` and `plan` events carry a closed
   step shape with no issues and no warnings member. Today's panel gets both lists from the
   server's own `proposal` event, which `propose_draft` emits after validating the draft.
   So either that event's schema grows advisory lists for this one kind, or the `proposal`
   event keeps carrying them beside a card that reads them from the panel's state, which is
   two proposals in one turn in everything but name and sits awkwardly with P1. Both are
   design choices with consequences for 080's panel and for the propose-tool cap.
2. **Which panel does the builder screen render?** `AssistantConversation` hands a form
   screen with a mounted, writable builder to `AssistPanel` in hosted mode, and that
   component renders the draft proposal panel and **no action card at all**. So on
   `/forms/[formId]` itself no card can be confirmed today; D1's other four kinds are
   reachable from the form subtree's other screens, where `ScreenConversation` runs. Making
   the proposal panel a kind means either moving the builder screen onto
   `ScreenConversation` and re-expressing the diff and the two lists as a card variant, or
   teaching `AssistPanel` to render cards as well. The first retires a shipped panel; the
   second leaves two card renderers.

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
| D6          | `question.create`, `question.saveDraft`, `question.publish`, `question.deprecate`, `question.newVersion`                |
| D7          | `form.create`                                                                                                           |
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

**The create variant is in** (Code Owner, 2026-11-01). `form.create`, `question.create` and
`question.newVersion` each call a non-redirecting variant of the screen's own action: the
same validation, the same route and so the same grant check, the same audit row, and the
new id or version returned as the one allowlisted field a later step may reference. The
card shows a link to what it made, built from the kind's own `createdLink` page route and
run through the admin's page-route allowlist, so it can never point at a route handler.

## Not started

- **D8's read half**: the agent audit surfaced beside the access audit on
  `workspaces/[workspaceId]`.
- **D1's `apply-draft` kind**, blocked above.
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
  rows are still open. They close when `apply-draft`, D8's read half and the read tools do.
