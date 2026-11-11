---
"create-qcms-app": patch
---

The per-form header reads a form's Availability, with the same three values as the lists.

- "Availability: Open", "Closed" or "Not Released" replaces "Status", so a form with no
  release in the selected environment no longer reads "Open" above a row that calls it
  "Not Released".
- `GET /admin/forms/{id}` carries that third reading. Create, close and reopen answer the
  two-valued lifecycle they always did.
- The availability door offers neither Close nor Reopen where nothing is released, and
  says so instead of offering a button the API would refuse.
- Operations reads "Not Released" where it read "No release".
- Versions heads its historical column "First released", and its environment summary reads
  "Not Released" where it was blank.
