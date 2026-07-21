# Wireframe - Admin form builder + condition editor

**Status:** Signed off: Ravi, 2026-07-21 · **Consumed by:** 033 · **Renders:** 022 (drafts, validate), 021 (library reads), 005 (`analyzeRuleGraph` client-side)

## ASCII sketch

```
┌─ Forms / Life insurance / Builder ──────────[Publish ▸]─┐
│ ┌─ steps ──────┐ ┌─ step: Health ──────────────────────┐│
│ │ 1 Health   ● │ │ q_smoker      @v2  [move pin ▾] [×] ││
│ │ 2 Lifestyle  │ │ q_cigs_daily  @v1  [move pin ▾] [×] ││
│ │ [+ add step] │ │ [+ add question from library]       ││
│ └──────────────┘ └─────────────────────────────────────┘│
│ ┌─ conditions (rul_smoker_followup) ──┐ ┌─ validation ─┐│
│ │ { "op":"equals",                    │ │ ✓ no issues  ││
│ │   "questionId":"q_smoker", … }      │ │              ││
│ │ show: [q_cigs_daily ▾]              │ └──────────────┘│
│ └─────────────────────────────────────┘                 │
│ ┌─ settings ─┐ ┌─ test bench ─┐        saved ✓ 12:03    │
└─────────────────────────────────────────────────────────┘
```

## Regions (normative)

- **header**: `breadcrumb` (Forms / {form} / Builder) · Publish `button` (primary - hands off to 034's flow) · save indicator (`text`: saved/dirty/saving + timestamp; autosave per 022 advisory semantics).
- **steps rail**: ordered step list (title, active indicator, per-step issue count `tag` when validation issues exist) · add step `button` · rename/reorder/remove via row `menu`. Reorder keyboard-operable.
- **step editor**: per-question row - questionId@version (`text`, monospace) · "move pin" `menu` listing available published versions (no auto-upgrade, no bulk - R7) · remove `button`. Add-question opens **library picker** `dialog`: search + `table` of published versions only, deprecated flagged (`tag`) and excluded for new pins (022). Duplicate-question-in-form prevented in UI.
- **condition editor** (per rule; rules listed with add/remove):
  - schema-aware JSON editor - **CodeMirror** (the recorded ADR-22 exception) with autocomplete for `op` (incl. `contains`/`containsAny` - ADR-21), `questionId` (pinned questions only), `optionId` (from the referenced question's pinned version).
  - `show` target picker `select` (multi) - pre-filtered to questions/steps **after** the rule's referenced questions via client-side `documentOrder` (teaches ADR-16 before publish rejects).
- **validation panel**: live `PublishError[]` from debounced `POST .../draft/validate` (022) + instant client-side `analyzeRuleGraph` findings; each entry anchored - click scrolls/focuses the offending rule/step/question via the structured `path`.
- **test bench** (collapsible `accordion`): pick a rule → enter hypothetical answers for its referenced questions (controls per type) → match/no-match result (`text`), clearly labeled read-only preview.
- **settings panel** (`accordion`): `challengeRequired` `switch` - inline warning `alert` when enabled with deployment provider `none` (ADR-24) · min-time floor `number-field` (026).
- **agent panel** (flag-conditional): see `admin-agent-panel.md` - docked right of the builder.

## States (normative)

new empty form · draft with issues (advisory - saving allowed, publish blocked) · draft clean · saving/saved/save-failed · backward-target attempt (instant client flag + validate-endpoint error if force-saved) · pin-move invalidates a rule's optionId (error surfaces at the rule) · concurrent-edit last-write-wins warning `alert`.

## Interactions

- Autosave → `PUT /admin/forms/:id/draft` (022; response carries `{draft, issues}`) · debounced validate → `POST .../draft/validate` · library reads → `GET /admin/questions*` (021) · Publish → 034's flow.
- Editor must never emit DSL the schema rejects (033 exit criterion - pickers are fuzzed).

## A11y notes

- Validation entries are links; activating one moves focus to the target control. CodeMirror region labeled; all pickers offer the keyboard path (no drag-only interactions). Issue counts announced on change via `aria-live` (polite). Rail reorder via menu commands, not drag.

Signed off: Ravi, 2026-07-21
