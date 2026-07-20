# 033 - Admin form builder and condition editor

**Stage:** 8a · **App:** `apps/admin` · **Depends on:** 032, 022 (draft/validate API), 005 (graph analysis exported)
**References:** ADR-03, **ADR-16, ADR-19** · R7 · **Wireframe:** `docs/wireframes/admin-form-builder.md` (042)

## Context

Compose pinned questions into steps; express branching in the structured condition editor. Per ADR-19 the editor is **structured JSON editing with live validation as the default** - a visual drag-and-drop builder is Phase 4. "Structured" means schema-aware editing with pickers and inline errors, not a bare textarea.

## Deliverables

- **Form builder:** create form (slug, title, defaultLocale); step list (add/rename/reorder/remove); per-step question picker from the library (published versions only; deprecated flagged and excluded for new pins per 022); explicit **manual pin display** - every ref shows `questionId@version` with a "move pin to vN" action listing available published versions (no auto-upgrade, no bulk move - R7); duplicate-question-in-form prevented in UI (mirrors 004's refinement).
- **Condition editor (structured):** per-rule editing of `{ when, show }`:
  - Schema-aware JSON editor (e.g. CodeMirror + JSON schema from the Zod DSL) with autocomplete for `op`, `questionId` (pinned questions only), and `optionId` values based on the referenced question's pinned version.
  - `show` target picker (questions/steps **after** the rule's referenced questions - the UI can pre-filter using `documentOrder`, teaching ADR-16 before publish rejects).
  - **Live validation:** debounced calls to `POST .../draft/validate` (022) rendering the full `PublishError[]` inline - errors anchored to the rule/step/question they name via the structured `path`. Client-side `analyzeRuleGraph` (005 exports it) gives instant backward-target/cycle feedback before the round-trip.
- Draft autosave (022's advisory-save semantics: inconsistent drafts save fine, issues listed); dirty/saved indicators; concurrent-edit last-write-wins with a warning (single-author launch assumption - issue for locking).
- **Form settings panel:** per-form domain toggles (ADR-24 tier 2): `challengeRequired` - with an inline warning when enabled while the deployment's challenge provider is `none` (unenforceable until an operator configures one) - and the min-time floor (026).
- Rule test bench: pick a rule → enter hypothetical answers for its referenced questions → shows match/no-match via client-side evaluation of that condition (uses core's evaluator on a synthetic snapshot - read-only aid, clearly labeled as preview).
- Playwright: build the insurance form from seeded questions entirely through the UI - steps, pins, the smoker rule - with live validation visible; save.

## Exit criteria

1. Playwright build-the-insurance-form suite green.
2. Backward-target authoring attempt: instant client-side flag *and* (if forced-saved) validate-endpoint error rendered at the rule.
3. Pin move: version change reflected; validation re-runs (a moved pin can invalidate a rule's optionId - the error must surface).
4. Editor never emits DSL the schema rejects (fuzz the pickers; serialize → parse with 005's schemas).
5. axe pass on builder and condition editor.

## Out of scope

Publish flow and preview (034), visual rule builder (Phase 4 - R7), collaborative editing (issue).
