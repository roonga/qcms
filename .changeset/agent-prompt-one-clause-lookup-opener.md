---
"create-qcms-app": patch
---

Regenerate the scaffolded API's assistant system prompt. The "Open with the
result" guidance now licences exactly one short clause naming a look-up when the
assistant has to look before it can answer, with a worked example of an acceptable
opener and of one that runs too long, and it asks for the answer straight after
the look-up rather than a second announcement. A reply that already has the answer
still leads with it and makes no announcement at all.
