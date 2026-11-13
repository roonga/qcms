# 117 - Theme action kinds and the derive flow

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `apps/admin` · **Depends on:** 110, 116, 112; the derive flow on the Agent Builder design canvas seen by the Code Owner
**References:** `plan/agent-builder-decisions.md` (G2, U5, G4, Q7, Q21) · SEC-17, SEC-18 · `plan/work-order-sequence.md`

## Context

The assistant's access to appearance and themes. `form.appearance` is a draft-scoped edit (111's path). `theme.derive` makes an outbound fetch, so it always takes a Confirm card showing the user-typed URL in full. G4b adds these kinds to the builder's prompt and fake-model scripts.

## Deliverables

- G2: action kinds `form.appearance` (draft-scoped, no card), `theme.derive` (Confirm card, URL in full, typed by the user, never by the model) and `theme.save` (Confirm card), with consequence bands; registered in `actions/registry.ts` and offered by the same evaluator as the screen.
- The model sees only 110's strict derive output: hex colours and a registry face enum; no page text, title, alt text or logo bytes.
- U5: the derive flow in the builder: URL input, the Confirm card, a "Not saved" row for the derived theme, save as a workspace theme, the correction messaging from 107.
- G4b: the system prompt section and `fake-model.ts` scripts for the three kinds.
- Strings in `apps/admin/lib/i18n/en.ts`.

## Exit criteria

Spec criteria owned: none. 110 owns criterion 119.

- A derive happens only after a Confirm on a card showing the full URL.

## Required tests

- Derive sentinel (X4): the derive output that reaches the model passes the strict schema and the SEC-17 sentinel; a fixture page with injected instructions in its text changes nothing the model sees.
- Kinds: the model cannot supply the URL; `theme.save` refused for a View forms holder; `form.appearance` refused on a locked workspace with the API's refusal.
- Playwright (X3): derive against the local fixture server (110), Confirm, "Not saved", save as a workspace theme, apply to the draft; axe clean.

## Files and areas

`apps/api/src/features/agent/actions/` (new theme kinds, `registry.ts`), `apps/api/src/features/agent/{grant-filter,system-prompt,fake-model}.ts`, `apps/admin/components/agent/{action-card,card-parts}.tsx`, `apps/admin/lib/agent/card-copy.ts`, `apps/admin/components/forms/` (derive flow), `apps/admin/lib/i18n/en.ts`, `apps/admin/e2e/`.

## Migration

None.

## Gates

V, D, B (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round (an outbound fetch behind a Confirm card, and model-facing derive output under SEC-17 and SEC-18); Sonnet delta.

## Design gate

Yes: the URL input, the derive Confirm card and the "Not saved" row on the Agent Builder canvas, seen by the Code Owner before dispatch.

## Out of scope

The fetcher (110). Operator docs for the SEC-18 flag (121).
