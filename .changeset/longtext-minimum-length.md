---
"@roonga/qcms-core": minor
"@roonga/qcms-a2ui-compiler": minor
"create-qcms-app": patch
---

A longer typed answer takes a minimum length

`longText` carried `maxLength` alone, so "at least a sentence" could not be set on the one type whose shape invites it, and a required description was answerable with one word. A `shortText` had the minimum and the wrong shape. The omission was not deliberate.

`longText.constraints` now takes `minLength` beside `maxLength`, counted exactly as the maximum is: UTF-16 code units of the canonical string, the unit the typed box itself counts in. No word count. `minLength` above `maxLength` is refused at parse with the existing `MIN_LENGTH_ABOVE_MAX_LENGTH`, enforcement is the existing `LENGTH_BELOW_MIN` under the `minLength` constraint, and the compiler forwards the bound to `TextArea` as the advisory hint `TextField` already carried. The admin's Constraints panel gains Shortest answer for the type, and the `minLength` validation message becomes authorable on it.

**No version stamp moves, and the choice is deliberate.** `SEMANTICS_VERSION` stays 1 and `SNAPSHOT_SCHEMA_VERSION` stays 2. The change is a widening in one direction only: every stored definition still parses, every published snapshot still evaluates and renders byte-identically, and no answer changes meaning. `authoredMessageKeys` moves for a `longText` only when the author sets the new constraint, so a `messages.minLength` on a `longText` that sets no minimum is still reported as `ORPHAN_MESSAGE_KEY` and nothing that published before stops publishing. What changes is that a draft refused for that key is now publishable once the constraint is set. The package versions carry it: a minor on the kernel and the compiler, because both gain a field and neither changes a canonical encoding. The golden corpus is untouched, no committed golden's bytes move, and no corpus input gains the constraint.
