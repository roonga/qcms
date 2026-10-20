---
"create-qcms-app": patch
---

Fix the scaffolded admin's draft preview for a repeating group presented "One page per
instance". The admin's preview read dropped the API's `visibleStepViews`, so the pane walked
steps rather than views; it now forwards the list (and keeps it absent when the API omits it).
Each preview page draws only its own instance, through the same renderer `view` option the
portal passes, instead of drawing every instance on every page, and the step line names the
instance the page draws ("Step 2 of 4: Passengers, Passenger 1"), as the portal's progress
indicator does.
