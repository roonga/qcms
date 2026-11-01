---
"create-qcms-app": minor
---

Operations rows open the form contexts their caller holds, in the selected environment.

- `GET /admin/operations/forms` reports a row's read cells beside its write cells, so a
  client can tell a context the caller may open from a field that is simply empty.
- The Operations table links each row to the operational contexts that row admits, each on
  its own cell and each link naming its own row. A row whose caller may only erase names
  the form and links nowhere.
- A form read refused rather than failed no longer takes the response browser with it, so
  an account holding `response: read` and no `form: read` can browse that form's responses.
