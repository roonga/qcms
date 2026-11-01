---
"create-qcms-app": minor
---

Mirror the question library's five action kinds into the scaffolding templates.

Creating a question, saving a draft version, publishing one, deprecating one and opening a
new version are each proposable through the screen's own path. The create and the new
version run non-redirecting variants, so a plan does not lose the steps after them, and
each returns the value a later step may reference: the new question id, or the new version
number.

A question definition is authoring content rather than respondent content, so it travels in
the step's arguments and the token's digest binds it: a save whose request carries a
definition the card never showed is refused and the stored draft is untouched.
