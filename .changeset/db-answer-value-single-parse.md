---
"@roonga/qcms-db": patch
---

Read an answer value back exactly as it was stored. `answers.value` was declared with
drizzle's `jsonb`, whose `mapFromDriverValue` parses any string it receives, and
node-postgres has already parsed the column: a stored JSON string was therefore parsed
twice. A text answer of `"234234234"` came back as the number 234234234, `"true"` as a
boolean, `"null"` as SQL NULL (reading as unanswered) and `"[1]"` as an array, so
`latestAnswers` handed the submit sweep a value of the wrong type and every digit-only
text answer was refused with `INVALID_TEXT_ANSWER`. Writes were always correct.

The column now uses a `jsonb` custom type whose `fromDriver` returns the driver value
unchanged. The SQL type is still `jsonb`, so no migration and no generated environment
DDL changes. The other `jsonb` columns hold objects at the top level and cannot hit this,
so they are left as they are.
