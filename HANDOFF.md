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

## Criterion 11's matrix: what it covers now

One spec per screen group, each on the shared walk in
`apps/admin/e2e/support/agent-card.ts` (the panel, one `#qcms-fake:propose-<kind>` or
`#qcms-fake:plan-<group>` turn, the card's controls and chips, the `control.agent_actions`
rows, axe scoped to `.qcms-acard`):

| Spec                              | Kinds confirmed alone and inside a plan                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `agent-cards-forms.pw.ts`         | `form.close`, `form.reopen`; the read-tool labels; the workspace audit; Expired                                    |
| `agent-cards-form-settings.pw.ts` | `form.settings`, with the close and the reopen again in one plan                                                   |
| `agent-cards-forms-list.pw.ts`    | `form.create`, with the created link                                                                               |
| `agent-cards-releases.pw.ts`      | `form.publish`, `form.release` (a promotion to production, the second step using the first's version)              |
| `agent-cards-links.pw.ts`         | `link.mint`, `link.revoke`; a plan that fails at step 2, which is Failed and Not run                               |
| `agent-cards-questions.pw.ts`     | `question.create`, `question.saveDraft`, `question.publish`, `question.newVersion`, `question.deprecate`           |
| `agent-cards-responses.pw.ts`     | `response.unflag`, `response.erase` (typed confirmation, irreversible band), `response.export` (hand-off, Running) |
| `agent-cards-workspace.pw.ts`     | all six D8 kinds, in two plans                                                                                     |
| `agent-cards-apply-draft.pw.ts`   | `apply-draft` alone, with the diff and both advisory lists                                                         |
| `agent-cards-webhooks.pw.ts`      | `webhook.create` and `webhook.rotate`, both alone                                                                  |

Twenty-five of the twenty-nine kinds, twenty-three of those inside a plan as well. The
three confirmed alone only are `apply-draft`, `webhook.create` and `webhook.rotate`: the
first carries the turn's own proposed draft and the propose tool keeps one such step per
plan, so a plan for it wants a second builder kind beside it; the other two wait on the
diagnostic below, because `plan-webhooks` is the plan all five configuration kinds belong
in.

Card states measured by axe: Proposed, Done, Cancelled, Expired, Failed, Not run and
**Running** (a hand-off step sends nothing and waits on the screen's own dialog, which is
the one Running state that stands still long enough to measure). The audit is read as a
**tally per kind**, not as the tail of the table: rows stamped from one pinned clock can
share a `confirmed_at` and the order inside an instant is the database's to choose.

## Not started, for the next round

- **Four webhook kinds and Pending approval.** `webhook.retarget`, `webhook.deactivate`,
  `webhook.reactivate`, `webhook.redeliver`, and the Pending approval state.
  - `webhook.redeliver` names a delivery row, which exists only once a response has fanned
    out to an endpoint: a published form, a submission and a delivery pass. That fixture
    writes into the delivery queue `responses-ops.pw.ts` counts, so it wants a form and a
    consumer of its own (`TestConsumer` in `apps/admin/e2e/support/ops.ts` answers 200, so
    nothing dead-letters).
  - **Pending approval** is the production endpoint path: with the workspace's
    second-approver switch on, an endpoint change in `prod` is held as an endpoint proposal
    (202, `apps/api/src/features/webhooks/handler.ts`) and the step settles
    `pending-approval`, terminal for the plan. The switch can be flipped and restored
    through the agent itself, as `agent-cards-workspace.pw.ts` does.
  - **A discovery to chase before writing the retarget cell.** With
    `propose-webhook-retarget` the PUT returned 200 and the screen's own re-read of
    `/webhooks` followed it, and the endpoints table still showed the old URL thirty
    seconds later. Those rows reach that component as props, so this is not the
    state-seeding staleness below. One diagnostic run first: assert the stored row rather
    than the table, and compare the environment the PUT and the list read resolve to.
    `plan-webhooks` is already in `fake-model.ts` and covers all five configuration kinds
    in one plan once the retarget is understood.
- **Criterion 13's** rehearsal of 038's goal 7.
- **The records "The records this task closes" names**: ADR-25's status line
  (`docs/adr/admin.md`), SEC-17's status line, its "Verified by (when built)" list and
  section 8's four-tool paragraph (`docs/SECURITY_DESIGN.md`), `docs/agent-authoring.md`
  section 4, 038's header, moving the four work orders out of `docs/features/`, and the
  ledger rows in `docs/features/README.md`. They close when the remaining criteria do.

## Product fixes the matrix found, each outside the agent's own code

Every one of these is reached by the screen's own controls too; the card matrix is simply
the first test to walk them.

- **A library screen offered its create to nobody.** `/forms`, `/forms/new`, `/questions`
  and `/questions/new` name no subject, so the grant filter had no workspace to judge
  `form.create` or `question.create` against and the propose tools were left out of the
  turn entirely. The filter now judges them against a workspace the caller may create in
  (`workspacesHoldingOrNone`), and which workspace the act lands in stays the route's own,
  from the arguments.
- **A 204 route read as JSON.** `removeHolder` and `deleteAccessGroup` parsed an empty
  body, so a revoke and a group removal the API had performed were reported to the operator
  as failures. `readNoContent` is the reader for a success with no body.
- **The workspace settings step sent a setting its card never showed.** It filled the
  absent member with `false`, which both changed a setting nobody confirmed and made the
  proposal's own digest unverifiable (`AGENT_PROPOSAL_ARGUMENTS`). It now sends the members
  the card carried.
- **The webhooks screen's facts read the control plane.** An endpoint and its deliveries
  are the environment's own rows, as the webhooks route reads them, so the assistant saw no
  endpoint on any deployment whose environments have their own data. The erasure log's
  tombstones and the dead-letter list had the same reader and move with it.
- **The response detail's flag disposition was state seeded once.** A release performed
  anywhere but that screen's own button revalidates the route, and the operator went on
  reading "Flagged" about an event already on its way. It re-seeds from the server, as the
  response browser re-seeds its filter draft.
- **The diff entries were too small to be targets.** Each `apply-draft` entry is a
  disclosure, and at the text's own height they were 18px rows a few pixels apart, which is
  SC 2.5.8 on both counts. No axe sweep had reached the apply-draft card before.

## Discoveries worth a ruling, none of them blocking

- **Two panels seed their controls once and are not re-seeded.** The workspace's
  second-approver switch (`workspace-settings-panel.tsx`) and the builder's form settings
  (`form-builder.tsx`) take their values from the server on first render and then carry the
  operator's own unsaved choice, so an act performed anywhere else is on screen at the next
  read rather than under their hand. The response detail's flag was re-seeded because it
  holds no unsaved choice; these two do, and discarding a half-made edit on a revalidation
  is a decision rather than a mechanical fix. Both specs read the value back on a fresh
  visit and say so.
- **The audit table overflowed and the conversation's scroll region needed a name**, both
  found in the previous round and both only once data or load existed. The same warning
  holds for the rest of the matrix: a table that fits today may not the first time it has
  ten rows.
- **The conversation's own error reporting was widened rather than narrowed.** The retired
  panel resolved each failure to its own sentence and the shipped screen conversation
  reported one generic line, so the shared conversation now uses the panel's resolver on
  every screen (`apps/admin/lib/forms/assist-errors.ts`).
- **The card's quoted reason is the turn's closing prose segment**, which is what the panel
  quoted, rather than the whole turn's text the screen conversation was clamping.
