---
"create-qcms-app": patch
---

Agent access parity audit (task 096).

- A proposed step's subject is checked against the route's own cells before a card exists, for
  every action kind rather than for the draft save alone, so no card is offered for a workspace,
  form or question the caller cannot reach.
- A held 202 reads as held rather than as done: a self-grant, turning second approval off and a
  prod-only draft publish hold the assistant's plan at that step, and the workspace panels and
  the publish wizard say the act is waiting for an Approver.
