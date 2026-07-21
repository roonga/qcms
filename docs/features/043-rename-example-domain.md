# 043 - Rename example domain: life-insurance/smoking to vehicle insurance

**Stage:** 7 (maintenance) · **Scope:** repo-wide example fixtures + docs · **Depends on:** 029
**Runs after:** 029, **before** 030 and 031-035 / 041 (the UI tasks build on these fixtures; the surface only grows if deferred). Numbered out of sequence like 040/041/042 - see `features/README.md`. Closes #16.
**References:** `DOMAIN_SCHEMA.md` §6 (canonical source) · **ADR-18** (golden corpus is append-only; determinism) · the rename map below

## Context

The canonical example/fixture domain is **life insurance + smoking**. Smoking/addiction content can be triggering and QCMS is public, so the owner directed a switch to a neutral **vehicle insurance** example (2026-07-22). The word "insurance" stays; only the life/smoking specifics change. The structure is identical (a boolean question opening a numeric follow-up), so this is a **pure rename with no behavior change** - the golden corpus stays a determinism anchor, its expected outputs carrying only renamed ids.

## Rename map (apply everywhere, consistently)

| Today | New |
|---|---|
| `frm_life_signup` "Life insurance sign-up" | `frm_auto_quote` "Vehicle insurance quote" |
| `stp_health` "Health" | `stp_history` "Driving history" |
| `q_smoker` (boolean) "Are you a smoker?" | `q_at_fault_accident` (boolean) "Any at-fault accident in the last 3 years?" |
| `q_cigs_daily` (number) "How many cigarettes daily?" | `q_accident_count` (number) "How many?" |
| `rul_smoker_followup` | `rul_accident_followup` |

The follow-up's numeric example value: keep it as-is for a strict rename, or set a realistic count (e.g. 2) and regenerate the affected golden expected-outputs - your call in review, but justify it and preserve determinism.

## Deliverables

- `DOMAIN_SCHEMA.md` §6 rewritten to the vehicle example (the worked branch and the ledger / hidden-answer walkthrough), plus every doc that cites the old ids (`ARCHITECTURE.md`, `PROJECT_GOAL.md`, `IMPLEMENTATION_PLAN.md`, `api-walkthrough.md`).
- Core fixtures renamed: `insurance.json`, the question fixtures, and the golden scenarios (`insurance-seq-*-smoker-yes/no` and siblings -> the accident equivalents), with expected FlowState outputs carrying the renamed ids.
- `docs/wireframes/*` labels updated. The signed-off **structure is unchanged**, so the 042 sign-off stands - state that in the change; do not re-open the gate.
- Every referencing task file (003, 006-009, 012, 019, 023, 027, 029, 030, 032-034, 041) updated in the same change (staleness rule).
- `apps/api` / `@qcms/db` / e2e fixtures and any hardcoded ids or labels swept.

## Exit criteria

1. Zero occurrences of `smoker` / `cigarette` / `cigs` / `q_smoker` / `q_cigs_daily` / `frm_life_signup` / `rul_smoker_followup` / `stp_health` (and "Life insurance", "Are you a smoker", "cigarettes daily", the `life-insurance` url slug) across tracked files (grep clean, case-insensitive).
2. **Full merge gate green, golden-drift especially** - proving no behavior change (renamed ids only, not new semantics).
3. The whole test suite runs with nonzero per-file counts, Docker suites force-run - a rename that breaks a fixture/id linkage must surface, not silently pass on a cache replay.
4. `docs/features/README.md` ledger row 043 -> done; `DOMAIN_SCHEMA.md` §6 is the single canonical example.

## Out of scope

Any change to the DSL, question types, evaluation semantics, or observable behavior - this is a rename only. New question types or example screens. The design artifacts and the Claude Design project are already updated (owner-driven, outside the repo).
