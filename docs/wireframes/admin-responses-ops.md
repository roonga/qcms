# Wireframe - Admin responses, erasure, webhook operations

**Status:** Signed off: Ravi, 2026-07-21 · **Consumed by:** 035 · **Renders:** 023 (responses/export/erase), 024 (webhook config), 025 (delivery state, redeliver)

## ASCII sketch - response browser + detail

```
┌─ Responses: Life insurance ─────────────────────────┐
│ [version ▾] [date range] [flagged ▾]     [Export ▾] │
│ ┌─ table ────────────────────────────────────────┐  │
│ │ ses_a1…  v3  2026-07-18 14:02  link   ⚑flagged │  │
│ │ ses_b2…  v3  2026-07-18 15:11  anon            │  │
│ └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
┌─ ses_a1… ───────────────────────────────────────────┐
│ locked answers        │ ledger (audit timeline)     │
│ Are you a smoker? Yes │ 14:01 q_smoker = true       │
│ Cigarettes/day:   12  │ 14:01 q_cigs_daily = 12     │
│ contentHash: ab3f…    │ 14:02 ── submitted ──       │
│ [Erase respondent data…]                            │
└─────────────────────────────────────────────────────┘
```

## Regions (normative)

- **browser toolbar**: version `select` · date range `date-picker` ×2 · flagged `select` · Export `menu` (CSV - version required; JSON).
- **browser `table`**: sessionId, formVersion, submittedAt, accessMode, flagged `tag`, answer preview. Pagination `[upstream gap]`. Row → detail.
- **detail**: locked answers with question labels resolved from the pinned version · **ledger timeline** (every change with timestamps - the audit view; matches `answerLedger` exactly, 035 exit criterion) · contentHash (`text`, copyable) · link state if secure-link · flag reason + **unflag** action (`dialog` confirm explaining the withheld webhook releases - 023).
- **erasure**: "Erase respondent data" `button` (danger) → **type-to-confirm `dialog`** (explains ADR-17: irreversible, tombstone remains, webhook consumers unaffected; requires typing the sessionId - no single-click path, 035 exit criterion). Post-erasure: detail shows the tombstone (`card`: erasedAt, reason). **Erasure log** screen: `table` of tombstones (023 `GET /admin/erasures`) - compliance evidence.
- **export UI**: format choice, version `select` (required for CSV, disabled-with-hint for JSON), date range; streams the download; empty-result message.
- **webhook config** (per form): create `dialog` - url `text-field` (https enforced outside dev), active `switch`; **secret shown exactly once** on creation (`alert` + copy `button`, "will not be shown again"); list `table` with masked secrets, rotate (new secret shown once) and deactivate actions.
- **delivery dashboard**: recent deliveries `table` - status `tag`, attempts, latency · **dead-letter list** - lastError, attempt history, per-item **redeliver** `button` + bulk redeliver · delivery detail (`accordion`): request headers (signature masked), response code/body snippet.

## States (normative)

no responses · filtered-empty · flagged present · detail submitted · detail erased (tombstone) · erase confirm (typed) · export empty-result · webhook none configured · secret-reveal (one-time) · deliveries healthy · dead-letters present · redeliver in-flight/succeeded.

## Interactions

- List/detail → `GET /admin/forms/:id/responses[/:sessionId]` (023) · export → `GET .../export?format=&version=&from=&to=` (023, streamed) · erase → `POST /admin/sessions/:sessionId/erase` (023) · unflag → `POST /admin/responses/:sessionId/unflag` (023) · webhook CRUD → 024 · redeliver → `POST .../redeliver` (025).
- Post-erasure the session must vanish from list/detail/export and appear in the log (035 exit criterion 2).

## A11y notes

- Type-to-confirm `dialog` labels the required input with the exact string to type; error announced. Ledger timeline is a list (chronology in text, not layout). One-time secret reveal announced assertively; masked thereafter. Redeliver outcomes announced via `aria-live`. Flag/status `tag`s carry text, not color alone.

Signed off: Ravi, 2026-07-21
