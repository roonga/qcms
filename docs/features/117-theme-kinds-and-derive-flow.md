# 117 - Theme action kinds and the derive flow

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `apps/admin` · **Depends on:** 110, 116, 112; the derive flow on the Agent Builder design canvas seen by the Code Owner
**References:** `plan/agent-builder-decisions.md` (G2, U5, G4, Q7, Q21) · SEC-17, SEC-18 · `plan/work-order-sequence.md`

## Context

The assistant's access to appearance and themes. The appearance act is a draft-scoped edit on 111's path. `theme.derive` makes an outbound fetch, so it always takes a Confirm card showing the user-typed URL in full. G4b adds these acts to the builder's prompt and fake-model scripts.

## Deliverables

- G2: the action kinds `theme.derive` (Confirm card, URL in full, typed by the user, never by the model) and `theme.save` (Confirm card), with consequence bands, registered in `actions/registry.ts` and offered by the same evaluator as the screen.
- G2: the appearance act is the builder tool `edit_appearance`, not an action kind (Code Owner, 2026-11-22). It yields 111's `appearance` edit op, so it auto-applies to the draft and shows "Applied to draft | Undo" with no Confirm card.
- The derive order is SEC-18 W2: the typed address is shown in full on a Confirm card before anything is fetched, and the model neither sees nor chooses it (Code Owner, 2026-11-22). The Brand board's post-fetch card is the messaging after the derive, not the gate.
- W2's Confirm card governs an agent-proposed derive. In the drawer's own Get theme the person's typed address and their click is the confirm, and no card stands between them (Code Owner, 2026-11-23).
- The card echoes the whole typed address as wrapping text above Confirm, so a long address cannot hide its host (Code Owner, 2026-11-23).
- Workspace Settings stays as 116 left it: no Derive or Save button there, both acts live in the appearance drawer, and `themes.create.note` is true through the drawer's Save as workspace theme (Code Owner, 2026-11-22).
- The model sees only 110's strict derive output: hex colours and a registry face enum; no page text, title, alt text or logo bytes.
- U5: the derive flow in the builder: URL input, the Confirm card, a "Not saved" row for the derived theme, save as a workspace theme, the correction messaging from 107.
- G4b: the system prompt section and `fake-model.ts` scripts for the three acts.
- Strings in `apps/admin/lib/i18n/en.ts`.

## Exit criteria

Spec criteria owned: none. 110 owns criterion 119.

- A derive happens only after a Confirm on a card showing the full URL.

## Required tests

- Derive sentinel (X4): the derive output that reaches the model passes the strict schema and the SEC-17 sentinel; a fixture page with injected instructions in its text changes nothing the model sees.
- Kinds: the model cannot supply the URL; `theme.save` refused for a View forms holder; `edit_appearance` refused on a locked workspace with the API's refusal.
- Playwright (X3): derive against the local fixture server (110), Confirm, "Not saved", save as a workspace theme, apply to the draft; axe clean.

## Files and areas

`apps/api/src/features/agent/actions/` (new theme kinds, `registry.ts`), `apps/api/src/features/agent/tools/edit.ts`, `apps/api/src/features/agent/{grant-filter,system-prompt,fake-model}.ts`, `apps/admin/components/agent/{action-card,card-parts}.tsx`, `apps/admin/lib/agent/card-copy.ts`, `apps/admin/components/forms/` (derive flow), `apps/admin/lib/i18n/en.ts`, `apps/admin/e2e/`.

## Migration

None.

## Gates

V, D, B (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round (an outbound fetch behind a Confirm card, and model-facing derive output under SEC-17 and SEC-18); Sonnet delta.

## Design gate

Yes: the URL input, the derive Confirm card and the "Not saved" row on the Agent Builder canvas, seen by the Code Owner before dispatch.

## Out of scope

The fetcher (110). Operator docs for the SEC-18 flag (121). Sending the derived-theme fact to a turn, so the prompt says only that a derive answers the person and not the model (#1404; Code Owner, 2026-11-23).
