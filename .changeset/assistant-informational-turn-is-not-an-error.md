---
"create-qcms-app": patch
---

An assistant turn that answers a question no longer ends with an error under the reply.

A read-only question ("what is in this form?") produced a correct answer followed by the red
`NO_PROPOSAL` notice, because the code treated every turn with no proposal as a failed one.
A question is not a failure, so a turn that answered and proposed nothing now ends clean.

`NO_PROPOSAL` is kept for the two cases where the person really is left with nothing: a turn
that produced no card and no words, and a turn that staged a draft and never put the card up,
which throws the staged work away. Its message says that rather than naming a missing draft.
