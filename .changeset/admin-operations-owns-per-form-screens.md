---
"create-qcms-app": minor
---

Operations owns every per-form operational screen, and the form editor is authoring.

- Responses, the response detail, Links and Webhooks are addressed under
  `/operations/forms/{formId}/`, where each reads the environment the shell's switcher
  names. Their old addresses still arrive, carrying their query, so a bookmark, a copied
  URL and an export link all land.
- Intake is a new screen, `/operations/forms/{formId}/intake`: what the selected
  environment serves, whether it is taking responses, and the close and reopen that change
  it. Those two acts left the builder, whose draft belongs to no environment.
- The assistant's `form.close` and `form.reopen` are the Intake screen's in both screen
  tables, and one form's offerable action kinds are two lists rather than one, so a plan
  never spans authoring and operational acts in a single confirmation.
