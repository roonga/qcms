---
"create-qcms-app": minor
---

Portal steps list and progress modes (task 119).

- Serve-step returns an ordered `steps` list (label, state, a cursor on completed steps, the
  current view's question labels) and `progressMode` from the pinned version's appearance.
- A cursor past the first step still missing a required answer serves the first incomplete
  step instead.
- The portal shows a side rail, the top indicator (the default) or no progress. The rail's
  completed steps are plain links without script, and below the `lg` breakpoint the rail
  folds into a disclosure.
