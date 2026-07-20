# Wireframe - Admin publish, preview, versions, secure links

**Status:** Draft (pre-027) · **Consumed by:** 034 · **Renders:** 022 (publish, versions, close/reopen, draft/preview), 024 (links), 028 (shared renderer)

## ASCII sketch - publish + preview

```
┌─ Publish "Life insurance"? ──────────── (dialog) ───┐
│ Freezes: 2 steps · 4 pinned questions · 1 rule      │
│ New sessions get v3; in-flight sessions finish       │
│ on their version.            [Cancel] [Publish v3]  │
└─────────────────────────────────────────────────────┘
┌─ Preview - not published ───────────────── (banner) ┐
│ ┌─ rendered step (shared renderer) ──────────────┐  │
│ │ Are you a smoker?  (•) Yes ( ) No              │  │
│ │ How many cigarettes daily? [   ]  ← appeared   │  │
│ └────────────────────────────────────────────────┘  │
│ [◂ prev step] [next step ▸]   [reset answers]       │
└─────────────────────────────────────────────────────┘
```

## Regions (normative)

- **publish `dialog`**: freeze summary (steps/pins/rules counts) + R1 teaching copy · confirm/cancel `button`s. On failure: full `PublishError[]` as an actionable list - each entry links back into the builder anchored via structured `path` (033's anchoring). On success: version `tag` + link to history.
- **preview**: banner `alert` ("Preview - not published") · dry-run compiled draft (`POST /admin/forms/:id/draft/preview`, 022 addition) rendered through **the same `@qcms/ui` renderer** (import-surface test - preview fidelity is the feature) · interactive answer state with live client-side rule evaluation (core evaluator) so authors walk branches · step prev/next `button`s · reset `button`.
- **version history**: `table` - version, publishedAt, compilerVersion / a2uiSpecVersion / semanticsVersion (`text`, monospace) · view action → read-only render **from stored compiled JSONB** (ADR-18 - network assertion: no draft-preview call on history pages) · side-by-side definition **JSON diff** between selected versions (readable, additions/removals marked textually not color-only).
- **secure links** (form with ≥1 published version): mint `dialog` - expiry `date-picker`, one-time `switch`, batch count `number-field` (≤ documented cap) → result list with copy-URL `button`s · links `table` - state `tag` (active/consumed/expired/revoked), consumption timestamp, revoke action (`dialog` confirm) · batch CSV export `button`.
- **close/reopen**: form-level actions with in-flight-session explanation (R1 taught in copy).

## States (normative)

publish confirm · publish errors (list rendered, nothing persisted) · publish success · preview walking branches (insurance fixture appears/disappears) · history empty (never published) · history multi-version + diff · links empty · links minted (URLs shown, copy feedback) · revoke confirm.

## Interactions

- Publish → `POST /admin/forms/:id/publish` (022) → 422 `PublishError[]` verbatim, or `{version, publishedAt}`.
- Preview → `POST /admin/forms/:id/draft/preview` (022/034) → 011 compiled output → shared renderer; answers stay client-side.
- History → `GET /admin/forms/:id/versions/:v` (022). Mint/list/revoke links → 024 endpoints; CSV export client-side from list data.
- Close/reopen → `POST /admin/forms/:id/close|reopen` (022).

## A11y notes

- Publish-error list entries are links; activation moves focus into the builder target. Preview branch changes follow the portal announcement policy (030) so authors experience what respondents will. Copy-URL confirms via status text (`aria-live` polite). Diff readable without color (± markers).

Signed off: _pending (042)_
