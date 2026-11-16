---
"create-qcms-app": patch
---

Refuse minting a respondent link in an environment the form is not live in.

- The mint route answers `FORM_NOT_RELEASED` (409) where the form has no release in the named environment.
- The admin shows that in plain words on the links screen and on the assistant card, and withholds the mint control there.
