# 050 - Answer retraction: tombstone append (ADR-33)

**Stage:** 7 · **Apps/packages:** `@qcms/core` · `apps/api` · `@qcms/db` · `apps/portal` · `packages/ui` (adapter seam) · **Depends on:** PR #90 (ADR-31 cadence) merged
**References:** ADR-33 (this task implements it) · ADR-31 (the null-clear contract line this fulfils) · ADR-17/R3 (append-only; retraction is an append, never a mutation) · issue #95 (folds it, including the untouched-required null post sharing root cause B) · SEC posture unchanged (same session/link authz as answer posts)

## Context

Issue #95, from PR #90's review cycle: clears are unobservable in the portal (react-aria emits nothing when a complete date goes incomplete) and unrepresentable in the API (no retraction path; null 422s). ADR-33 decided the tombstone append. Both causes need fixing; either alone leaves the ledger stale or the UX worse.

## Deliverables

- **Kernel:** a retraction record type appended alongside answers; `latestAnswers` resolves newest-is-retraction to unanswered; visible-required validation and the rules evaluator treat retracted as never-answered. No `null` enters `AnswerValue`.
- **API:** a retraction post on the answers seam (executor's design call: distinct body shape or endpoint, justified in the PR), same authz/rate rules as answers; the untouched-required blur no longer posts an invalid `null` (root cause B's second symptom).
- **DB/read model:** reporting view and exports resolve retracted to absent; append-only constraint tests extended to the new record.
- **Portal/adapter:** make clears observable at the adapter seam (the DatePicker complete-to-incomplete gap; check every control type against its ADR-31 commit moment), then post the retraction at that moment. Continue must stop advancing past a required question whose answer was retracted (the #95 repro becomes a Playwright spec).
- **Golden corpus:** any compiler-visible change is APPENDED, never edited (expected: none - retraction is runtime, not compile-time; assert this).

## Exit criteria

1. The #95 browser repro fails on main and passes on the branch: answer required date, clear it, Continue does not advance; the error summary names the question.
2. Retraction resolution proven at the read-model seam (latestAnswers integration tests; no kernel change - per the accepted ADR-33 amendment there is no per-type kernel path to test, the null branch runs before validateAnswer); append-only proven (no UPDATE/DELETE on the answers table in the diff or at runtime).
3. API: retraction post round-trip integration-tested; untouched-required blur produces no 422 noise.
4. Reporting/export: a retracted answer is absent from both, regression-tested.
5. `pnpm verify` + `verify:browser` green; changeset for `@qcms/core` (+ `@qcms/db` if its surface changes); screenshot gate for the respondent-visible states.

## Out of scope (binding)

Editing or deleting answer rows (erasure stays the only DELETE door); admin-side retraction tooling; retraction of submitted (locked) sessions; any `null` in `AnswerValue`.
