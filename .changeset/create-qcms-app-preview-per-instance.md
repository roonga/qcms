---
"create-qcms-app": patch
---

Fix the scaffolded admin's draft preview for a repeating group presented "One page per
instance". Each preview page now draws only its own instance, through the same renderer `view`
option the portal passes, instead of drawing every instance on every page. The step line also
names the instance the page draws ("Step 2 of 4: Passengers, Passenger 1"), as the portal's
progress indicator does.
