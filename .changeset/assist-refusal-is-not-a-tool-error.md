---
"create-qcms-app": patch
"@roonga/qcms-observability": patch
---

Stop counting a refused verb as a failed tool call in the assist turn record (issue #840).

`noteToolFailure` asked whether a `tool-error` part was a refusal by testing the part's
error with `NoSuchToolError.isInstance`. That guard could never match. The SDK settles an
unallowlisted verb inside `parseToolCall`, which catches its own `NoSuchToolError` and
returns an `invalid: true` tool-call part, and the `tool-error` part built from it carries
the error already stringified (read against ai 7.0.92,
`src/generate-text/stream-language-model-call.ts`). So the branch was dead, its comment
described a route the refusal has not taken, and every refused turn logged
`toolErrors: 1` for a call that never reached an executor.

The refusal has one route and always did: the parsed `tool-call` part, where `toolName`
survives intact, which is where the turn is recorded refused and where the loop's stop
condition reads it. `noteToolFailure` now takes the failed call's tool name and skips
counting one the allowlist rejects, using the same membership test as the tool set, the
dispatch door and the event mapping. Nothing about the refusal itself changes: no proposal
is yielded, the refusal copy is emitted once, the loop still stops at the refusing step,
and the record still names no tool error text (SEC-8). What changes is that `toolErrors`
now counts only calls that actually failed, which is what an operator reads it for - a
model correcting itself, told apart from a model that cannot call this API at all.

The observability change is the record catching up: the SEC-13 export vocabulary note for
`draft assistant turn` enumerates the attributes that are dropped on export, and
`toolErrors` was missing from that list. It was already dropped, because the allowlist
names the attributes that travel rather than the ones that do not; only the comment was
incomplete.
