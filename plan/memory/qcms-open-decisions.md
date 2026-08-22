---
name: qcms-open-decisions
description: Decisions currently waiting on the Code Owner, and the historical disposition record
metadata: 
  node_type: memory
  type: project
  originSessionId: 9e5da939-93c1-4e50-a639-645e68acd50d
  modified: 2026-08-22T02:15:00.000Z
---

**Read this section first. It is the reason the file exists.**

## Waiting on the Code Owner as of 2026-08-22

The previous revision of this file ended its summary with *"No Code Owner decision is currently pending."* That was true on 2026-07-26 and had been false for weeks by the time anyone read it again. A boot-time memory asserting that nothing is pending will suppress exactly the escalation it should prompt, so this section is now the top of the file and **is dated on every edit**.

**Plan PRs open, all `plan/`-only, all green, verified to merge cleanly against `main` individually and in sequence:**

- **#594** - contract amendments: §2 splits ids by minting convention, §3 is claim-versus-capability, §6 is one model per scope.
- **#608** - **§9, a ninth contract** (author-authored text of unbounded length). Explicitly **not** covered by the 2026-08-20 confirmation, which was given over eight. This one needs a decision rather than a merge.
- **#599** - the admin UX audit swept against what has landed.
- **#610** - this seat's workstream snapshot, which had gone a month stale, plus the stale-checkout trap.

**Decisions with no PR attached:**

- **The `admin-redesign` tier's future.** All twelve authorised issues (#510-#515, #517-#522) are **closed**. Nineteen-plus remain under the label, none from the original set: they are all second-generation, found while draining the first. "Drain the twelve" was authorised on 2026-08-19; "drain whatever the twelve uncover, recursively" was not. Options: let the label stand as rolling, close it as discharged and re-prioritise against the whole backlog, or draw a new explicit tier.
- **PR #438's premise** - 333 files renaming the published npm scope to `@roonga`, open since 2026-08-09 with no engagement. It rests entirely on "the `qcms` organisation is not available on npm", which **contradicts `CLAUDE.md`** and cannot be checked from inside this seat: a package-name 404 does not distinguish a free scope from a held one. One check settles whether the PR should exist at all.
- **Instruction fixes filed but unmakeable from here** (all outside `plan/`): **#600** embed gate frames by commit SHA, **#604** one forced run is not evidence a suite is stable, **#605** the gate-directory naming convention that silently flipped, **#606** stop grouping `better-auth` with `jscpd`, **#607** capture re-shoots regenerate every frame, **#609** the browser gate outlasts its own timeout and drops the lock.
- **#618** - the empty library recommends a command that cannot work against the stack showing it. Lands on **038**'s path, where an external tester follows the README alone.

**Launch-path human gates** (`docs/features/README.md` is authoritative; 54 of 62 tasks done):

- **030** manual screen-reader pass - automated portion landed 2026-07-22.
- **040** security sign-off - the implementation **merged 2026-08-16** (PR #495) and exit criterion 3 is met. Waiting on the signature, not on work.
- **038** launch-gate validation itself.

Remaining implementation on that path: **049**, **061**, **037**. **041 never gates 038** (flag-gated, ADR-25). **039** is Stage 9.

---

## Historical disposition record

Everything below is kept as history. It was accurate when written and is **not** a statement about today.

**Disposition sweep 2026-07-26:** #20 (disproven - spec nonce-hiding, PR #84), #21 (PR #75), #31 (ADR-31, PR #90), #66 (option 2, PR #103) all CLOSED; #22 -> ADR-32/task 048; #26 -> ADR-30 amendment/task 049 (launch tier); #95 retraction -> ADR-33/task 050 DONE. **#53 and #128 both DECIDED 2026-07-26** (Code Owner "use recommended"): #53 portable subset - `checkSafePattern` compiles with the `v` flag, `u`-only patterns rejected at authoring time; #128 required means non-blank - trim before the required predicate, stored values stay as-typed. Decisions + acceptance criteria are comments on the issues; titles carry "(decided: ...)" so the loop's semantic filter no longer excludes them.

- **SAST gate + baseline sweep** (raised 2026-07-21, issue #14): **DONE 2026-07-21.** Landed serverless: CodeQL (`security-and-quality`) server-side + `eslint-plugin-sonarjs` in lint + jscpd `check:duplication` (3% threshold) locally, all in CI. Baseline swept: all 65 sonarjs findings cleared, project tuning documented inline in `eslint.config.js` with rationale; jscpd accepts R5 vertical-slice repetition. See [[qcms-project-state]] static-analysis division.

Issue #5 (@qcms/db enum-row types) - spec'd, scheduled 030->031 via executor+reviewer; **031 has since landed**. Harness Write-guard blocks task-declared doc/changeset deliverables - flagged to the Code Owner, harness-config level.

**Portal review findings A-N** (manual review 2026-07-23; running log in the scratchpad review artifact). Disposition:

- **Fixed by task 045 (ADR-28), no separate issue:** M (multi-choice auto-collapsed - S1), N (final Submit regressed - S1), G (no Back vs signed 042 wireframe); E (no kitchen-sink e2e/axe coverage), L (e2e only ran mobile viewport), B (no browser console-error gate - also relates to #19) all fold into 045's exit criteria.
- **Filed as GitHub issues 2026-07-23 (roonga/qcms):** #20 A (CSP-nonce hydration mismatch), #21 C (indistinguishable error links, WCAG 3.3.1), #22 D (author-supplied custom error messages - needs ADR), #23 H (auto-advance + date input-mode admin toggles; 045 stubs the `advanceOnComplete` schema flag), #24 I (multi-language authoring UI; schema/ADR-11 ready, no admin UX), #25 J (hardcoded `QCMS` brand -> adopter/admin config), #26 K (managed theming).
- **Managed theming (#26 / finding K)** was the open decision here. It is **settled**: ADR-30 amended, task **049**, launch tier. The earlier text describing it as needing "a new ADR + task set" contradicted this file's own opening paragraph and is superseded.
- **Hardcoded-text audit (ADR-27 follow-up):** the Code Owner asked for a full portal audit of user-facing strings -> tasks for customization across schema/admin/api. Deprioritized behind 045; the ADR-27 consequences already promise a portal-chrome audit + a no-hardcoded-user-text guard.

See [[role-qcms-product-owner]].
