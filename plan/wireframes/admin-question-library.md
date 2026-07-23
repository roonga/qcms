# Wireframe — Admin question library

**Status:** Draft (pre-027) · **Consumed by:** 032 · **Renders:** 021 (question CRUD/versions/publish/deprecate)

## ASCII sketch — library list + editor

```
┌─ Questions ─────────────────────────────────────────┐
│ [search…]  [status ▾] [type ▾]        [+ New question]
│ ┌─ table ────────────────────────────────────────┐  │
│ │ q_smoker      Are you a smoker?  boolean  v2 ●published
│ │ q_cigs_daily  How many…          number   v1 ○draft
│ └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
┌─ Edit q_smoker (v3 draft) ──────────────────────────┐
│ type: boolean (locked)         id: q_smoker (fixed) │
│ label [Are you a smoker?     ]  required [✓]        │
│ help  [                      ]                      │
│ ┌─ constraints (per type) ───────────────────────┐  │
│ └────────────────────────────────────────────────┘  │
│            [Save draft] [Publish v3] [Deprecate…]   │
└─────────────────────────────────────────────────────┘
```

## Regions (normative)

- **list toolbar**: search `text-field` (slug/label text) · status filter `select` (all/draft/published/deprecated) · type filter `select` (7 types) · "New question" `button` (primary).
- **list `table`**: columns — questionId (`text`, monospace), label, type, latest version + status `tag` (draft/published/deprecated), updated. Row click → detail. Pagination `[upstream gap]` (compose from `button`s).
- **detail — version timeline**: per-version row — vN, status `tag`, publishedAt · read-only rendered preview of any version **via the shared renderer** (single-question compiled doc — 032 documents the mechanism; import-surface: no second renderer).
- **editor `form`**:
  - type picker `select` — **locked after creation** with explanatory `tooltip` ("changing type is a new question — R6").
  - questionId `text` — generated `q_` + slug, displayed prominently, immutable; creation dialog explains immutability.
  - label / help `text-field`s (defaultLocale only at launch) · required `switch`.
  - **constraints panel, per type**: shortText → min/max `number-field` ×2 + pattern `text-field` with live regex feedback; longText → max `number-field`; number → min/max `number-field` + integer `switch`; date → min/max `date-picker` ×2; boolean → none; choice types → **option list editor**: rows of optionId (`text`, auto-generated `opt_`, immutable once created) + label `text-field`, reorder controls, add/remove `button`s; multiChoice adds min/max-selected `number-field`s.
  - live Zod validation: 003 error paths render inline at the offending field.
- **lifecycle actions**: Publish (`dialog` confirm: "becomes pinnable; content frozen") · New version (`dialog`: "creates draft vN+1") · Deprecate (`dialog`: "blocks new pins; existing forms unaffected"). Confirmations teach the rules (032).

## States (normative)

empty library (+ seed hint: `pnpm qcms:seed-fixtures`) · list filtered-empty · editor new · editor draft-dirty/saved · publish confirm · API errors surfaced friendly (`VERSION_IMMUTABLE`, `QUESTION_ID_REUSED`) · deprecated question viewed (read-only, badge).

## Interactions

- Create → `POST /admin/questions` (021) · edit draft → `PUT .../versions/:v` · publish → `POST .../publish` · new version → `POST .../versions` · deprecate → `POST .../deprecate` · list/detail → `GET`s. No delete exists anywhere (R6).
- Option reorder must keep optionIds stable (032 exit criterion — rules depend on it).

## A11y notes

- Table: proper headers, row action reachable by keyboard. Option editor reorder operable without drag (up/down `button`s). Validation errors `aria-describedby`-linked. Lifecycle `dialog`s trap focus, return focus on close. Status conveyed by text in `tag`s, not color alone.

Signed off: _pending (042)_
