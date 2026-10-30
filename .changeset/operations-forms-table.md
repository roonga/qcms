---
"create-qcms-app": minor
---

Replace the admin's responses picker with the Operations forms table, and move the two
global queues into Operations.

- `/operations` lists the forms a caller operates in one explicitly chosen environment,
  through `GET /admin/operations/forms`: bounded search, workspace and intake filters,
  six stable orders and cursor paging.
- The whole view is the address, so a filtered table is a link, survives a refresh and is
  restored by browser back. Choosing an environment resets the page position and keeps the
  filters that are still valid.
- A filter changes the rows below it and nothing above them: the mode header, the
  environment and the page heading stay put.
- No release, closed intake, no matching results, a denied bookmark, a read in flight and
  a read that failed are six distinct states. A failed read is never an empty
  installation.
- `/responses` redirects to the table. `/webhooks` and `/responses/erasures` are Operations
  destinations reached from its rail, with their installation-only authorization unchanged,
  and both leave the normal navigation.
- The installation claim alone now enters Operations, since the two global queues are its
  own destinations.
