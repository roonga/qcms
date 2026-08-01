# 033 - Admin form builder and condition editor

**Stage:** 8a · **App:** `apps/admin` · **Depends on:** 032, 022 (draft/validate API), 005 (graph analysis exported)
**References:** ADR-03, **ADR-16, ADR-19** · R7 · **Wireframe:** `docs/wireframes/admin-form-builder.md` (042)

## Context

Compose pinned questions into steps; express branching in the structured condition editor. Per ADR-19 the editor is **structured JSON editing with live validation as the default** - a visual drag-and-drop builder is Phase 4. "Structured" means schema-aware editing with pickers and inline errors, not a bare textarea.

## Amendments (2026-08-01, PO seat; staleness rule)

Two lines below originally said the kernel ran **client-side** in the admin. That contradicted landed enforcement: rule 1 of `apps/admin/lib/server/r2-import-surface.test.ts` bans `@qcms/core` imports in the admin outright, and the test is not to be weakened. The PO seat resolved it the way 032's preview resolved the identical tension: **core runs in the API, where it already lives.**

- The **rule test bench** evaluates server-side, via `POST /admin/forms/{id}/draft/preview-condition` (a sibling of 032's question-preview route). It remains a clearly-labelled read-only aid.
- **`analyzeRuleGraph` runs server-side too**, and needed no new route: the kernel's `compileDraft` already calls it, so `POST .../draft/validate` has always returned `RULE_BACKWARD_TARGET` and `RULE_CYCLE`. The "instant feedback" intent is kept by `eligibleTargets` (pure draft geometry, no kernel) plus debouncing, not by importing core.
- The **schema-aware JSON editor** is the planned shape, not a detour: CodeMirror is adopted as the recorded ADR-22 exception the wireframe already names. An editor widget is not a form control; a2ra remains the only form-control stack, and CodeMirror renders in `apps/admin` only.

## Amendment (2026-08-01, Code Owner ruling on issue #246; staleness rule)

The live-validation bullet below used to promise an "**ADR-31 warning** when a multiChoice-driven rule targets a same-step question". No such warning exists and none is being built. `PublishError` in `packages/core/src/publish-error.ts` enumerates the whole set validate can return - `DANGLING_QUESTION_REF`, `DANGLING_OPTION_REF`, `DANGLING_STEP_REF`, `UNPUBLISHED_QUESTION_PIN`, `LOCALE_INCOMPLETE`, `RULE_BACKWARD_TARGET`, `RULE_CYCLE`, `RULE_DEPTH_EXCEEDED`, `RULE_TYPE_MISMATCH`, `DUPLICATE_QUESTION_IN_FORM`, `DUPLICATE_STEP_ID` - and it carries no severity field, so there is no warning channel for the builder to render. This was never a missing wire-up in 033; it was an upstream artifact task 022 never built.

The ruling is **option (b)**: correct the plan to match what validate can actually emit. The kernel and API do **not** grow a warning channel, and **task 022 is not reopened**. The bullet is corrected below.

The builder needs no change to be ready if a warning channel is ever added: `apps/admin/lib/forms/issues.ts` falls back to `t("forms.issue.unknown", { code })` for any code outside `ISSUE_MESSAGES`, so an unrecognized code surfaces rather than being dropped.

## Deliverables

- **Form builder:** create form (slug, title, defaultLocale); step list (add/rename/reorder/remove); per-step question picker from the library (published versions only; deprecated flagged and excluded for new pins per 022); explicit **manual pin display** - every ref shows `questionId@version` with a "move pin to vN" action listing available published versions (no auto-upgrade, no bulk move - R7); duplicate-question-in-form prevented in UI (mirrors 004's refinement).
- **Condition editor (structured):** per-rule editing of `{ when, show }`:
  - Schema-aware JSON editor (e.g. CodeMirror + JSON schema from the Zod DSL) with autocomplete for `op`, `questionId` (pinned questions only), and `optionId` values based on the referenced question's pinned version.
  - `show` target picker (questions/steps **after** the rule's referenced questions - the UI can pre-filter using `documentOrder`, teaching ADR-16 before publish rejects).
  - **Live validation:** debounced calls to `POST .../draft/validate` (022) rendering the full `PublishError[]` inline, errors anchored to the rule/step/question they name via the structured `path`. `analyzeRuleGraph` runs **server-side**, inside that same validate call: the kernel's `compileDraft` already includes it, so backward-target and cycle findings arrive with every round trip and no second endpoint exists. The instant pre-round-trip feedback comes from `eligibleTargets` (`lib/forms/draft.ts`), pure draft geometry with no kernel involved, which pre-filters the target picker and flags an ineligible pick immediately.
- Draft autosave (022's advisory-save semantics: inconsistent drafts save fine, issues listed); dirty/saved indicators; concurrent-edit last-write-wins with a warning (single-author launch assumption - issue for locking).
- **Form settings panel:** per-form domain toggles (ADR-24 tier 2): `challengeRequired` - with an inline warning when enabled while the deployment's challenge provider is `none` (unenforceable until an operator configures one) - and the min-time floor (026).
- Rule test bench: pick a rule → enter hypothetical answers for its referenced questions → shows match/no-match via **server-side** evaluation of that condition (`POST .../draft/preview-condition`, which runs core's evaluator on a synthetic snapshot in the API, beside 032's question-preview route - read-only aid, clearly labeled as preview).
- Playwright: build the insurance form from seeded questions entirely through the UI - steps, pins, the at-fault-accident rule - with live validation visible; save.

## Exit criteria

1. Playwright build-the-insurance-form suite green.
2. Backward-target authoring attempt: instant client-side flag *and* (if forced-saved) validate-endpoint error rendered at the rule.
3. Pin move: version change reflected; validation re-runs (a moved pin can invalidate a rule's optionId - the error must surface).
4. Editor never emits DSL the schema rejects (fuzz the pickers; serialize → parse with 005's schemas).
5. axe pass on builder and condition editor.

## Out of scope

Publish flow and preview (034), visual rule builder (Phase 4 - R7), collaborative editing (issue).
