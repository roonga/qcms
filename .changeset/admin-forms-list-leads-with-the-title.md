---
"create-qcms-app": patch
---

The forms list names a form rather than listing its identifiers.

- `GET /admin/forms` carries each row's `title`, from its draft else its latest published
  version. It is the same read the search already made, so the list costs no extra query.
- A row leads with that title, keeps its address on a line below, and offers the form id to
  copy instead of spending a column on it. An untitled form leads with its address.
- The form section header names the form the same way and demotes its id to the same copy
  control.
