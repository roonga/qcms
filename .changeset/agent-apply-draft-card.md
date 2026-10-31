---
"qcms-api": minor
"qcms-admin": minor
---

The assistant's draft proposal becomes the `apply-draft` action card, and the shipped
proposal panel is retired (Code Owner, 2026-11-01).

- `propose_draft` records and validates a draft and saves nothing. The model then proposes
  `apply-draft`, whose step carries the draft, the questions it invents and both advisory
  lists, so a draft reaches the person as a card like every other act and P1 (one proposal
  per turn) holds for it too. The separate `proposal` event is gone.
- `apply-draft` reaches no route: Confirm hands the draft to the builder, which stores it
  through the one save path every other edit takes, with the sticky agent-assisted mark. A
  kind that reaches no route carries no token, and a plan's token now binds only the steps
  that do, so `apply-draft` can be a plan's first step without shifting any later step's
  provenance check.
- The builder screen runs the same conversation every other screen runs, so one card
  renderer serves them all and the builder screen can confirm D1's other kinds there. A
  writer's turn still takes that form's own route and carries the stored draft's
  `updatedAt`, so a draft saved between the turn and Confirm is refused.
- The conversation now shows the step timeline, the reasoning disclosure and each failure's
  own sentence on every screen, which were the panel's and are now shared. `AssistPanel`,
  its strings and its CSS are removed.
