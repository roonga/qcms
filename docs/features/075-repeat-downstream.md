# 075 - Export, reporting and the webhook payload

**Stage:** 8c (launch scope) · **Apps/packages:** `@roonga/qcms-csv`, `@roonga/qcms-db` (the reporting view generator), `apps/api` (the export route and the outbox payload), `apps/admin` (the export screen's shape choice) · **Depends on:** 071, 072, 073
**References:** ADR-42 · ADR-10 (reporting before a public API) · ADR-17 (erasure, retention and outbox copies) · SEC-13 · SEC-16 · `docs/reporting-view.md` · `docs/webhooks.md` · `plan/repeating-groups-and-table-input.md` sections 5.3 to 5.6, and Q17, Q18, Q19 · issue #470

## Context

**This task closes a data-loss window, not a feature gap**, and that is why it sits early in the build order rather than after the two remaining presentations. Two things below the API silently lose repeated answers today:

- `reporting.responses` aggregates with `jsonb_object_agg("elem"."item" ->> 'questionId', ...)`, and two locked answers for one `questionId` is exactly what a repeated question produces. `jsonb_object_agg` **silently keeps one**. No error, no warning.
- `questionIdsInDocumentOrder` is built on a stated premise, "a questionId is pinned at most once across a form, so the result is duplicate-free". The premise survives, but one column per question does not: an open-ended group has no column count until the data is read.

Until this lands, no deployment may use a repeating group.

## Deliverables

- **Both CSV shapes** (Q17, ruled 2026-09-30; the plan had recommended the long shape alone).
  - **Long, the default.** `responses.csv` unchanged for every question outside a group, with the same metadata columns, document order, BOM, CRLF and golden byte test. One extra file per group, named for the group: `session_id, instance_ordinal, instance_id, <one column per member question in document order>`, one row per `(session, live instance)`. A form with at least one group exports as a **zip** of those files; a form with none exports exactly the single file it exports today, so no existing adopter's pipeline moves.
  - **Wide, an option.** A shape parameter on the export route beside the `version` parameter CSV already requires, defaulting to long. The wide shape folds indexed columns (`q_passport__1` through `q_passport__<max>`) back into one flat `responses.csv`, with columns beyond a session's live count empty.
  - `@roonga/qcms-csv`'s formula-injection guard (issue #470) and the `;` join for multiChoice apply unchanged in **every** file of both shapes.
- **The wide shape's consequence documented beside the route, not only in the plan.** A wide export's **header depends on each version's `max` and changes when `max` changes**: raise a group's `max` in a later form version and that version's wide export has more columns, silently, from a consumer's point of view. The existing `version` requirement is what makes a wide export automatable at all, so the export screen and the route's documentation both say that a consumer who automates a wide export pins the version they bound to, and that the long shape is the one with a stable header. Under SEC-16 there is no installation-wide ceiling above `max`, so nothing stops an author declaring the 500 that produces 500 columns per member question; that makes this documentation load-bearing rather than cautionary.
- **`reporting.answers_flat` gaining a nullable `instance_id`**, its grain becoming `(session, questionId, instanceId)`. Appending a column is a **minor** `@roonga/qcms-db` release under the documented stability promise, and a consumer selecting explicit columns is unaffected.
- **`reporting.responses.answers` gaining one key per group id** holding an ordered array of `{instance_id, <questionId>: value, ...}`, with `questionId -> value` kept for every question outside a group. A form with no group produces a **byte-identical** `answers` object.
- **The `jsonb_object_agg` fix.** This is the deliverable the task exists for; everything else could wait and this cannot.
- **`docs/reporting-view.md` and its drift test moving in the same change**, and the change applied to the view **generator** rather than to a literal list, because under ADR-40 the views are per environment and, after task 068, per workspace.
- **`LockedAnswer.instanceId` reaching the outbox payload inside the `answers` member and nowhere else.** That is not stylistic: erasure and the retention sweep both redact by dropping exactly one jsonb key (`payload - 'answers'`), and migration 0016's CHECK `outbox_redacted_payload_has_no_answers` enforces that a redacted payload holds no `answers` key. Content in a sibling member (`groups`, `rows`, `instances`) would escape both, silently, and the first anyone would know is a subject-access request answered with data that was supposed to be erased.
- **The redacted payload carrying no instance ids, no roster and no counts** (Q19). A count is not an answer, but "how many dependants" and "how many passengers" are disclosive on their own, and the CHECK's guarantee is cheapest to keep as "after redaction there is no respondent-derived value of any kind".
- **`docs/webhooks.md` gaining an example** with an instance.
- **SEC-13's span and log allowlists gaining `ins_`** as a permitted pseudonymous correlator: no value, no count and no label follows it.
- **Ordering rules for the locked set**: document order for questions, roster order for instances. `canonicalJson` already preserves array order and its own doc says order is meaning, so a form with no group produces a byte-identical `LockedSubmission` and therefore a byte-identical `contentHash`, which the committed insurance golden hash asserts for free.
- **Changesets** for `@roonga/qcms-csv` and `@roonga/qcms-db`, both minor.

## Exit criteria

Acceptance cases **46 to 53** of `plan/repeating-groups-and-table-input.md` section 11. This task owns those and no others, including case 53 (no answer value or instance label in any exported span or log, `ins_` permitted), which belongs here because this task is what changes the allowlist. Plus:

1. **A walk of the payload asserting no respondent content outside the `answers` key**, before and after redaction, with the CHECK holding. The redaction and its CHECK both depend on that property and nothing else states it.
2. A CSV export of a form with **no** group is byte-identical to today's in **either** shape, asserted by the golden byte test.
3. The wide shape's header is asserted against two versions of one form whose `max` differs, so the documented consequence is a test rather than a warning.
4. `pnpm verify` green, and the forced Docker-backed run confirmed to have executed, because the reporting assertions need a real Postgres.

## Files and areas

`packages/csv/src/`, `packages/db/src/reporting/` (the view generator) and its drift test, `docs/reporting-view.md`, the export route and the outbox payload builder in `apps/api/src/features/`, the redaction paths in `packages/db/src/queries/{erasure,retention}.ts` (assertions only; 072 added the table), the observability allowlists, `docs/webhooks.md`, the admin export screen, changesets.

## Gates

`pnpm verify`, and the forced Docker-backed run (`pnpm exec turbo run test --force`, confirmed at `0 cached`). A browser gate applies only to the export screen's shape control; run `QCMS_PORT_SEAT=<0-9> pnpm verify:browser` detached if that control gains a spec, and in sequence with the forced run rather than concurrently (issue #863).

## Out of scope (binding)

The `/api/v1` public API, which is Phase 4 and stays there. Any change to the CSV metadata columns or to the existing wide file's content for a non-repeating form. Impact analysis. The two remaining presentations (076, 077). Storing an aggregate: a table's column total is presentation only, drawn and never stored, submitted or exported, and an author who needs the total stored asks for it as a question.

## Notes for the executor

**`jsonb_object_agg` fails silently, which is why this is the one deliverable with no acceptable workaround.** Write the failing assertion first, against a session with two instances of one question, and watch the pre-change view return one of them.

**The sibling-member temptation is real and the CHECK is what catches it.** A `groups` key beside `answers` would read better in the payload and would escape both the redaction and the CHECK. Put every repeated value inside `answers`.
