# 038 — Launch-gate validation

**Stage:** 8b (the launch gate) · **Scope:** whole product · **Depends on:** 036, **040** (and 037 if ready — ADR-19 fallback applies)
**References:** `PROJECT_GOAL.md` §4 · `IMPLEMENTATION_PLAN.md` Stage 8b exit · **ADR-19**

## Context

The launch gate is a human test, not a CI job: someone who is not the author of the code performs the full loop from the README alone. An agent prepares everything; a human external tester (not Ravi) executes. This task is the preparation, execution support, and evidence.

## Deliverables

- **Tester script** (`docs/launch-validation.md`): the checklist the tester follows — deliberately thin, because the *README* is what's being tested; the script only defines the goals and evidence to capture:
  1. From a clean machine: scaffold via `create-qcms-app` (or the documented manual setup if the CLI lags — record which was used).
  2. Bring the stack up; create the admin account; enroll 2FA.
  3. Author: create ≥3 questions including a choice type; publish them; build a form with one branching rule; publish it.
  4. Respond: complete the form twice via secure link and anonymously, exercising both branch paths, on a phone for at least one run.
  5. Receive: see both responses in admin; export CSV; receive the signed webhook at a provided test receiver (supply a one-command receiver, e.g. `npx qcms-webhook-echo`, that verifies the signature and prints the payload).
  6. Operate: erase one response; verify the export excludes it; view the tombstone.
- **Evidence log template:** per step — success/failure, time taken, friction notes verbatim, screenshots. Friction is data: every point where the tester left the README (searched, guessed, asked) is an issue.
- **Pre-flight:** all CI suites green (kernel, corpus drift, conformance, e2e, **security matrix (040)**, compose smoke, restore drill, CLI e2e if in scope); axe/Lighthouse gates green; a11y manual pass (030) has no open blockers; **security review doc (040) dated and cited, zero open high-severity findings**; version stamps in a published snapshot verified by hand once.
- **Triage rule:** launch-blocking = the tester cannot complete a step from the README, or data-integrity/auth failures. Everything else → issues (label `post-launch-polish`). Fix blockers, re-run only the failed steps with a *fresh* environment.
- Launch collateral check: README final pass, LICENSE, repo description, versioned package publish (Changesets release PR), tagged release.

## Exit criteria

1. An external tester completes all six goals from the README alone; evidence log committed.
2. Zero launch-blocking findings open.
3. Packages published; release tagged; the announcement can honestly repeat `PROJECT_GOAL.md` §4's launch criteria.

## Out of scope

Marketing/launch-post writing (separate effort), fixing non-blocking friction (issues), Phase 4 anything.
