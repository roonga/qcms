# Wireframe - Portal respondent flow

**Status:** Signed off: Ravi, 2026-07-21 · **Consumed by:** 029 (portal), 030 (a11y pass) · **Renders:** 018 (start-session), 019 (get-step, submit-answer), 020 (submit)

## ASCII sketch - flow step page (`/s/:sessionId`)

```
┌─ page ──────────────────────────────────────────────┐
│ [logo slot]                    Step 2 of 4: Health  │
│ ┌─ step ─────────────────────────────────────────┐  │
│ │ Health                                     (h1)│  │
│ │ Are you a smoker?                              │  │
│ │ ( ) Yes   (•) No                               │  │
│ │ ── inserted on branch ─────────────────────    │  │
│ │ How many cigarettes daily?                     │  │
│ │ [ 12          ]                                │  │
│ └────────────────────────────────────────────────┘  │
│                              [Back]  [Continue ▸]   │
└─────────────────────────────────────────────────────┘
```

## Regions (normative)

- **page**: minimal chrome - logo slot (shell theming, 029), progress text ("Step N of M: {title}"), no nav (respondents never navigate freely).
- **step**: rendered entirely by `A2UIStepRenderer` (028) from the stored compiled document - the wireframe does not enumerate per-question markup; the renderer + compiled doc own it. Contains: step heading (h1 from document), question controls (a2ra components per 011's mapping), per-question inline error slots, honeypot field (invisible, 026).
- **actions**: `button` Continue (primary; label becomes "Submit" on the final visible step when `readyToSubmit`), `button` Back (secondary; absent on first step).
- **error-summary** (state-conditional, above step): `alert` listing failed validations, each entry a link that moves focus to the offending field (WCAG 3.3 - 030).
- **challenge slot** (pre-session only, flag-conditional): Turnstile container rendered on the entry page before session creation, never on step pages (ADR-24, 029).

### Companion screens (inventory-only)

- **Entry - anonymous** (`/f/:formSlug`): form title (`text`), start `button` → BFF start-session → redirect to flow. States: form closed (`FORM_CLOSED` friendly page), not found, no published version.
- **Entry - secure link** (`/l/:token`): silent verify-and-redirect on success; friendly typed-error pages for `LINK_EXPIRED` / `LINK_CONSUMED` / `LINK_REVOKED` (`alert` + explanation text, no retry affordance).
- **Completion** (`/done`): receipt `card` - submittedAt, contentHash (`text`, copyable), "you may close this page" copy.
- **Resume recovery**: friendly page when `/s/:sessionId` lacks a valid cookie - explanation + link to form entry.
- **Expired session**: typed-reject page (retention sweep) - explanation, start-again link if the form is open.

## States (normative)

first-step · mid-flow · branch-inserted (follow-up appears) · branch-removed (answered follow-up disappears) · per-field validation error (422 from submit-answer) · submit blocked (missing visible-required → error-summary) · readyToSubmit · submitted (further answers rejected) · no-JS fallback (plain form POST per step - degraded but functional, 029) · link-error pages ×3 · expired.

## Interactions

- Answer change/blur → `POST /sessions/:id/answers` (019) → re-render step from returned flow projection (branch changes happen here).
- Continue on final step → `POST /sessions/:id/submit` (020) → completion page, or 422 → error-summary state.
- Anonymous start → BFF → `POST /sessions` (018). Secure link → BFF verify → same.

## A11y notes (feed 030)

- Branch insert: focus stays on the answered control; insertion announced via `aria-live` ("1 question added").
- Branch remove of the focused question: focus moves to next visible question, else step heading (030 owns the policy).
- Step change announced: "Step N of M: {title}". Submit failure: focus moves to error-summary `alert`.
- Full keyboard traversal; skip link; honeypot invisible to AT (verified in 030's manual pass).

Signed off: Ravi, 2026-07-21
