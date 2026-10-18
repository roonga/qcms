---
"create-qcms-app": patch
---

Fix three misleading readouts in the scaffolded admin's agent-assist panel (issue #1065).

The proposal diff no longer marks a rule "Changed" when the model echoed it back with its
keys in a different order: the stored draft has been through Postgres `jsonb`, which reorders
keys, so every existing rule was listed as changed on every turn. Content is now compared with
object keys sorted and array order kept.

A pin on a question the proposal itself invents now says what happens next - Accept creates it
as an unpublished draft, and it must be published before the form - instead of the builder's
"Pin it, or change the reference", which was wrong for a question that is already pinned.

The `NO_PROPOSAL` message no longer tells the author to "try a smaller change" under a reply
that declined an out-of-scope request or answered a question.
