---
"@qcms/db": minor
---

Export sound, hand-authored row interfaces for the tables whose Drizzle
`$inferSelect` type degrades to a TypeScript `error` type across the package's
emitted `.d.ts` (issue #5). `pgEnum` columns (`forms.status`, `sessions.status`,
`sessions.access_mode`, `question_versions.status`) and branded-id columns
(`text().$type<BrandedId>()` on `secure_links`, `answers`, `questions`, and the
above) both fail declaration emit, so consumers saw `no-unsafe-*` typed-lint
errors and had to launder each read through local view interfaces plus casts.

`FormRow`, `SessionRow`, `QuestionVersionRow`, `QuestionRow`, `SecureLinkRow`,
and `AnswerRow` are now hand-authored interfaces that survive the boundary
soundly. Enum-member unions are derived from the `pgEnum` definitions
(`FormStatus`, `SessionStatus`, `AccessMode`, `QuestionStatus` are exported), so
a schema enum change cannot silently desync. A compile-time drift guard in each
row module asserts the interface stays structurally identical to
`typeof table.$inferSelect`, failing the build if a column is added, dropped, or
retyped. No behavior change: these are type-only edits over shape-preserving
helpers.
