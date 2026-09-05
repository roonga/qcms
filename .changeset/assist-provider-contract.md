---
"@roonga/qcms-observability": patch
"create-qcms-app": patch
---

Ship a tool schema a strict provider can actually convert, and stop describing a permanent
provider refusal as a transient one (issues #820 and #818).

`propose_draft`'s input wraps `FormDefinition`, whose `rules[].when` is the recursive
`Condition`, so a Zod-to-JSON-Schema conversion hoists that node into a draft-07
`definitions` block and leaves a `$ref` behind. LM Studio's schema-to-grammar conversion
reads `$defs` and not `definitions`: the block was dropped as an unknown keyword, the
surviving reference resolved to nothing, and the entire tool set was rejected with HTTP 400
before any inference ran. Renaming the keyword is not the fix, because the node is also
self-recursive and a provider that resolves a reference by inlining it (the AI SDK's Google
provider refuses a cycle outright) cannot take that shape either. The emitted document is
now rewritten into a self-contained, acyclic one: references numbered by remaining depth,
unrolled to the deepest condition the golden corpora actually contain, and branches that
would need one more level dropped. The advertisement narrows and the acceptance does not,
because every tool executor still re-parses its input with the untouched Zod schema.

`PROVIDER_ERROR` held two conditions with opposite guidance - the vendor is down, where
waiting is right, and the account cannot pay, where waiting is useless. It now splits on
the SDK's own `isRetryable` into `PROVIDER_REJECTED`, whose copy sends the operator to the
provider account. No vendor message, error code or URL reaches that copy.

`@roonga/qcms-observability` classifies the one new log literal in the exported event vocabulary,
so a provider refusal an operator must act on leaves a countable trace with no vendor text
in it. `create-qcms-app`'s templates carry both changes.
