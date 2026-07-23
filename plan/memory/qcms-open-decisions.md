---
name: qcms-open-decisions
description: Owner-raised forward decisions to schedule/formalize (not yet in the numbered plan)
metadata: 
  node_type: memory
  type: project
  originSessionId: 9e5da939-93c1-4e50-a639-645e68acd50d
  modified: 2026-07-22T21:32:11.612Z
---

Decisions Ravi has raised that need scheduling or formalizing into the plan:

- **SAST gate + baseline sweep** (raised 2026-07-21, issue #14): **DONE 2026-07-21.** Landed serverless: CodeQL (`security-and-quality`) server-side + `eslint-plugin-sonarjs` in lint + jscpd `check:duplication` (3% threshold) locally, all in CI. Baseline swept: all 65 sonarjs findings cleared, project tuning documented inline in `eslint.config.js` with rationale; jscpd accepts R5 vertical-slice repetition. See [[qcms-project-state]] static-analysis division.

Also open (from Stage 6 audit): issue #5 (@qcms/db enum-row types) — spec'd, scheduled 030→031 via executor+reviewer. Harness Write-guard blocks task-declared doc/changeset deliverables — flagged to Ravi, harness-config level.

**Portal review findings A-N** (manual review 2026-07-23; running log in the scratchpad review artifact). Disposition:
- **Fixed by task 045 (ADR-28), no separate issue:** M (multi-choice auto-collapsed — S1), N (final Submit regressed — S1), G (no Back vs signed 042 wireframe); E (no kitchen-sink e2e/axe coverage), L (e2e only ran mobile viewport), B (no browser console-error gate — also relates to #19) all fold into 045's exit criteria.
- **Filed as GitHub issues 2026-07-23 (roonga/qcms):** #20 A (CSP-nonce hydration mismatch), #21 C (indistinguishable error links, WCAG 3.3.1), #22 D (author-supplied custom error messages — needs ADR), #23 H (auto-advance + date input-mode admin toggles; 045 stubs the `advanceOnComplete` schema flag), #24 I (multi-language authoring UI; schema/ADR-11 ready, no admin UX), #25 J (hardcoded `QCMS` brand → adopter/admin config), #26 K (managed theming). Not yet triaged into the numbered plan.
- **Managed theming (#26 / finding K):** predefined themes + customize + save named custom theme (`@qcms/db` storage + admin UI + apply to portal). Needs a **new ADR + task set**; open decisions: launch vs Phase-4, per-deployment/form/org granularity, mutable operator config vs versioned/immutable like published forms.
- **Hardcoded-text audit (ADR-27 follow-up):** Ravi asked for a full portal audit of user-facing strings → tasks for customization across schema/admin/api. Deprioritized behind 045; the ADR-27 consequences already promise a portal-chrome audit + a no-hardcoded-user-text guard.

See [[role-qcms-product-owner]].
