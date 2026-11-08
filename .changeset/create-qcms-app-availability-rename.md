---
"create-qcms-app": minor
---

The admin calls a form's intake its Availability.

- The per-form Operations screen is `/operations/forms/{formId}/availability`, and the old
  address redirects to it permanently.
- "Open", "Closed" and "Not Released" are the three readings everywhere they appear: the
  rail row, the Operations and Versions columns, and the Forms list column and filter.
- `GET /admin/forms` reads and filters that third state, so a form with no release in the
  environment no longer reads "Open" in the library.
- Close and reopen keep their verbs. The button, the confirmation and the closed note say
  what closing stops and what it leaves running, and the Versions column reads
  "Released to".
- The API's close and reopen refusals name the form rather than its intake.
- Storage and wire names are unchanged: the `closed` column, `POST /admin/forms/:id/close`
  and `/reopen`, and the `intake` query parameter on `GET /admin/operations/forms`.
