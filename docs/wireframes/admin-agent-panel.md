# Wireframe - Admin agent panel (agent-assisted form building)

**Status:** Signed off: Ravi, 2026-07-21 · **Consumed by:** 041 · **Renders:** `POST /admin/forms/:id/draft/assist` (a 041 route, SSE; flag-gated and **not part of the frozen 027 core contract**) · visible only when `QCMS_FLAG_AGENT_AUTHORING` ≠ `none`

## ASCII sketch - docked beside the builder (033)

```
┌─ builder (033) ─────────────┐┌─ Assistant ─────────┐
│                             ││ You: vehicle insurance  │
│                             ││ quote, at-fault accident  │
│  (steps rail, step editor,  ││ a follow-up          │
│   conditions, validation)   ││ ── proposal ──────── │
│                             ││ + step: Driving history       │
│                             ││ + q_at_fault_accident (boolean) │
│                             ││ + q_accident_count (num) │
│                             ││ + rule: accident→show  │
│                             ││ ✓ validation passes  │
│                             ││ [Accept into draft]  │
│                             ││ [Discard]            │
│                             ││ [describe change…] ▸ │
└─────────────────────────────┘└─────────────────────┘
```

## Regions (normative)

- **panel** (collapsible, docked right of the builder; absent entirely when the flag is `none` - not hidden, not rendered):
  - **conversation**: turns list - user turns (`text`) and assistant turns; assistant streaming progress shown with a working indicator `[upstream gap: progress]` (`text` + `aria-busy` until upstream lands).
  - **proposal diff** (per completed proposal, `card`): grouped additions/changes vs the current draft - steps, questions (with type), rules - each line `+`/`~` marked textually; expandable detail per item (`accordion`) showing the full definition.
  - **validation line**: the proposal's advisory `PublishError[]` (server ran 022 validation before returning - 041): "✓ validation passes" or an issue list, each anchored into the diff item it concerns.
  - **actions**: **Accept into draft** `button` (primary - merges the proposal into the working draft; never publishes) · Discard `button` · input `text-field` + send `button` for the next instruction.
  - **provenance marker**: once any proposal is accepted, the builder header and 034's publish confirmation show "draft includes agent-assisted changes" (`tag`) - the human publishing knows what they're signing (ADR-25).
- **guardrail surface (implicit)**: the panel exposes no publish/erase/links/webhooks affordances of any kind - the tool allowlist is server-side (041), and the UI mirrors it by simply not offering those actions.

## States (normative)

flag off (panel absent; no assist routes mounted) · empty conversation (prompt hint: "describe the form you want") · streaming proposal · proposal ready (validation clean) · proposal ready with issues · accepted (draft updates; builder re-renders; provenance tag appears) · discarded · provider error (`alert`: provider down / misconfigured) · rate-limited (`alert` with retry-after) · proposal rejected by validation entirely.

## Interactions

- Send → `POST /admin/forms/:id/draft/assist` (041, SSE stream) → streamed progress → completed proposal `{proposedDraft, newQuestions[], rationale, issues}`.
- Accept → merges into the draft via the normal draft save (`PUT /admin/forms/:id/draft`, 022) - the builder's own autosave/validation loop takes over; nothing bypasses it.
- All further authoring (pin moves, publish) continues through 033/034 unchanged - the agent is an author, not a second pipeline.

## A11y notes

- Panel is a labeled complementary landmark; collapse state persists. Streaming progress announced politely ("assistant is working"), completion announced ("proposal ready, 4 additions, validation passed"). Diff entries are a list; accept/discard reachable in order after the diff. Provider errors use `alert` semantics. Focus moves to the proposal summary when a proposal completes, back to the input after accept/discard.

Signed off: Ravi, 2026-07-21
