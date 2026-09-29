# 038 - Launch-gate validation

**Stage:** 8b (the launch gate) · **Scope:** whole product · **Depends on:** 036, **040**, **071 to 077** (stage 8c, repeating groups) (and 037 if ready - ADR-19 fallback applies)
**References:** `PROJECT_GOAL.md` §4 · `IMPLEMENTATION_PLAN.md` Stage 8b and Stage 8c exits · **ADR-19** · **ADR-42**, **ADR-43**, **SEC-16** (repeating groups, ruled into launch on 2026-09-29)

## Context

The launch gate is a human test, not a CI job: someone who is not the author of the code performs the full loop from the README alone. An agent prepares everything; a human external tester (not the Code Owner) executes. This task is the preparation, execution support, and evidence.

## Deliverables

- **Tester script** (`docs/launch-validation.md`): the checklist the tester follows - deliberately thin, because the _README_ is what's being tested; the script only defines the goals and evidence to capture:
  1. From a clean machine: scaffold via `create-qcms-app` (or the documented manual setup if the CLI lags - record which was used).
  2. Bring the stack up; create the admin account; enroll 2FA.
  3. Author: create ≥3 questions including a choice type; publish them; build a form with one branching rule **and one repeating group**; publish it. The repeating group exercises all three presentations across the run: one stacked, one per-instance-step and one table (ADR-42, ADR-43; the Code Owner's ruling of 2026-09-29 put all three in launch scope).
  4. Respond: complete the form twice via secure link and anonymously, exercising both branch paths, on a phone for at least one run. **Add and remove an instance of the repeating group in each run**, and do one run with scripting disabled, since the no-JS roster operation is the part of that feature with no fallback behind it.
  5. Receive: see both responses in admin; export CSV **in both shapes, long and wide**, and confirm every instance is present in each; receive the signed webhook at a provided test receiver (supply a one-command receiver, e.g. `npx qcms-webhook-echo`, that verifies the signature and prints the payload) and confirm the repeated answers are inside its `answers` member.
  6. Operate: erase one response; verify the export excludes it, **including its group instances**; view the tombstone.
- **Run log template:** per step, record success or failure, time taken, relevant command output, and friction notes verbatim. Every point where the tester left the README to search, guess, or ask becomes an issue.
- **Pre-flight:** all CI suites green (kernel, corpus drift, conformance, e2e, **security matrix (040)**, compose smoke, restore drill, CLI e2e if in scope); axe/Lighthouse gates green; a11y manual pass (030) has no open blockers; **security review doc (040) dated and cited - `docs/security-review-2026-08-14.md` as of that pass (040 landed it; a later pass supersedes it by date) - with zero open high-severity findings**; version stamps in a published snapshot verified by hand once.
- **Triage rule:** launch-blocking = the tester cannot complete a step from the README, or data-integrity/auth failures. Everything else → issues (label `post-launch-polish`). Fix blockers, re-run only the failed steps with a _fresh_ environment.
- Launch collateral check: README final pass, LICENSE, repo description, versioned package publish (Changesets release PR), tagged release.

## Exit criteria

1. An external tester completes all six goals from the README alone; run log committed.
2. Zero launch-blocking findings open.
3. Packages published; release tagged; the announcement can honestly repeat `PROJECT_GOAL.md` §4's launch criteria.

## Out of scope

Marketing/launch-post writing (separate effort), fixing non-blocking friction (issues), Phase 4 anything.
