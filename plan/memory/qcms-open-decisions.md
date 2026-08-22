---
name: qcms-open-decisions
description: Decisions currently waiting on the Code Owner, and the historical disposition record
metadata: 
  node_type: memory
  type: project
  originSessionId: 9e5da939-93c1-4e50-a639-645e68acd50d
  modified: 2026-08-22T14:30:00.000Z
---

**Read this section first. It is the reason the file exists.**

## Do not list open PRs here. Query them.

This file has now gone stale **twice in the same way**, and the second time it happened within a day of being rewritten to stop it happening.

- Rev 1 ended with *"No Code Owner decision is currently pending."* True on 2026-07-26, false for weeks before anyone read it again.
- Rev 2 fixed that by enumerating the open plan PRs (#594, #599, #608, #610) under a dated heading. **All four merged the same day**, so a boot-time memory dated 2026-08-22 asserted four merged PRs were awaiting a decision.

Dating the section did not save it, because the problem is not freshness discipline - it is that **PR state is not memory-shaped.** A fact that changes without anyone editing this file does not belong in this file.

**So: the live list is a query, not a list.**

```
gh pr list -R roonga/qcms --state open
gh issue list -R roonga/qcms --state open --label needs-decision
```

What belongs below is only what a query **cannot** tell you: what the decision is *about*, and why it matters.

## Standing decisions the Code Owner holds (durable, not perishable)

- **Whether ADR-27 and SEC-1 to SEC-13 survive "remove all limits on the admin portal."** WCAG was answered on 2026-08-21 (an **aim** for the admin, not a blocking gate). The other two were never answered, and this seat will not infer them from a design instruction. Recorded in `plan/admin-design-contracts.md`.
- **How far POC-wins reaches when a drawing proposes removing shipped behaviour.** The live instance is the `rules-screen-poc` route split: Validation cannot move without breaking the focus-moving issue anchors and the publish rejection list, while Rules can at a stated price. `plan/admin-ux-audit.md` §5.5 is the only place all four extractions in that rail were ever costed.
- **What the `admin-redesign` label means now that its twelve authorised issues are all closed.** "Drain the twelve" was authorised 2026-08-19; "drain whatever the twelve uncover, recursively" was not, and by inspection it does not terminate. The security cluster waits behind whatever this decides.
- **PR #438's premise** - 333 files renaming the published npm scope. It rests on *"the `qcms` organisation is not available on npm"*, which contradicts `CLAUDE.md`. **Measured 2026-08-22:** `registry.npmjs.org` is reachable and returns 404 for `qcms`, `@qcms/core` and `@roonga/core`, so nothing is published under either scope - but a package 404 does not distinguish a free scope from a held one, and the org endpoints return 403 (bot protection, not an answer). **One authenticated `npm org ls qcms` settles it.** Do not read a 403 or an auth error as evidence the name is taken.
- **Instruction fixes filed but unmakeable from this seat** (everything outside `plan/` is ask-gated). These accumulate; find them with the query above rather than trusting a list here.

**Launch-path human gates** (`docs/features/README.md` is authoritative - do not copy its counts here):

- **030** manual screen-reader pass, **040** security sign-off (implementation merged 2026-08-16, waiting on the signature rather than on work), **038** launch-gate validation.
- **041 never gates 038** (flag-gated, ADR-25). **039** is Stage 9.

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
