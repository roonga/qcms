---
"create-qcms-app": patch
---

Regenerate the scaffolded API's assistant system prompt. The prompt now tells
the assistant to speak to form builders in their own words, to lead with who did
what, to check for a proposal that is already waiting before putting up another,
to cover an outcome on one card or say up front what has to wait, to be honest
that a failed step's reason reaches the card and not the model, and to say that
a test link's address is shown once. The safety rules and the tool guidance are
unchanged.
