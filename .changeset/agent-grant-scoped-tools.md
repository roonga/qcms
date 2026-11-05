---
"create-qcms-app": patch
---

The in-app assistant's tools follow the signed-in user's own grants rather than the screen they are on: one typed read tool per admin GET route, subject ids that default to the screen's, and action kinds offered wherever the user holds the cell. A new `form.saveDraft` kind takes a form from nothing to a reviewable draft under one Confirm, and a card opens in a dialog with a wizard for a multi-step plan.
