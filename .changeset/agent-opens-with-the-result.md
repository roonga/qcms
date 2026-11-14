---
"create-qcms-app": patch
---

The assistant opens with the result and answers "why did you stop?" from the conversation.

- The first sentence is what it did or found, not how it is about to find out, and it does not
  answer the same question twice in one reply.
- A question about an earlier turn is answered from that turn: the reason it gave then, in the
  same words. It cannot see its own reasoning after the fact or what an earlier turn showed it,
  so neither may be offered as a cause, and it does not rerun the same lookups to answer.
