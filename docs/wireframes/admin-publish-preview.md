# Wireframe - Admin publish, preview, versions, secure links

**Status:** Signed off: Code Owner, 2026-07-21 · **Consumed by:** 034 · **Renders:** 022 (publish, versions, close/reopen, draft/preview), 024 (links), 028 (shared renderer)

> **Amendment, 2026-08-02 (task 034, staleness rule).** This wireframe originally placed the
> preview's rule evaluation **client-side** ("live client-side rule evaluation (core
> evaluator)"). Landed enforcement forbids it, exactly as it forbade the same thing for the
> rule test bench: rule 1 of `apps/admin/lib/server/r2-import-surface.test.ts` bans
> `@qcms/core` imports in the admin, and that test stands. It is also not what the portal
> does - the portal performs no rule evaluation either (R2), it receives an authoritative
> `visibleQuestions` list from the API and projects the compiled document onto it.
>
> So `POST /admin/forms/:id/draft/preview` returns **both** halves of that pair: 011's
> compiled documents and the forward pass's visible set for the answers sent with the
> request. The preview pane projects with `documentForVisible` - the portal's own function,
> moved into `@qcms/ui` by 034 so there is exactly one of it - and renders with
> `A2UIStepRenderer`. Fidelity is stronger for the change rather than weaker: the admin is
> not a second implementation of visibility, it is the same one. Nothing about the layout,
> regions or states changes.
>
> Two smaller notes from the same landing. The mint dialog's **one-time control is a
> `Checkbox`, not a `switch`**: the vendored a2-react-aria set has no Switch, and
> hand-writing one is what ADR-22 forbids, so adding one is a `COMPONENT_GUIDELINES`
> vendoring in its own right rather than a detail of this screen. And the **link expiry is a
> day** rather than an instant, widened to the end of that day before it reaches the API,
> because "which day does this stop working" is the question an author has.
>
> **Amendment, 2026-08-02 (Code Owner ruling).** The preview renders inside a single
> container element that owns its styling boundary (`qcms-preview-surface`), and nothing in
> the preview path assumes it shares the admin's theme context. 034 builds the boundary
> only: no theme selection, no mode switching, no portal-theme defaulting. Task 058 mounts
> its theme island on that container.

## ASCII sketch - publish + preview

```
┌─ Publish "Vehicle insurance"? ──────────── (dialog) ───┐
│ Freezes: 2 steps · 4 pinned questions · 1 rule      │
│ New sessions get v3; in-flight sessions finish       │
│ on their version.            [Cancel] [Publish v3]  │
└─────────────────────────────────────────────────────┘
┌─ Preview - not published ───────────────── (banner) ┐
│ ┌─ rendered step (shared renderer) ──────────────┐  │
│ │ Any at-fault accident in the last 3 years?  (•) Yes ( ) No              │  │
│ │ How many? [   ]  ← appeared   │  │
│ └────────────────────────────────────────────────┘  │
│ [◂ prev step] [next step ▸]   [reset answers]       │
└─────────────────────────────────────────────────────┘
```

## Regions (normative)

- **publish `dialog`**: freeze summary (steps/pins/rules counts) + R1 teaching copy · confirm/cancel `button`s. On failure: full `PublishError[]` as an actionable list - each entry links back into the builder anchored via structured `path` (033's anchoring). On success: version `tag` + link to history.
- **preview**: banner `alert` ("Preview - not published") · dry-run compiled draft (`POST /admin/forms/:id/draft/preview` - a planned thin extension of 022's draft slice that **034 lands**; deliberately **absent from the frozen 027 contract**, which predates it) rendered through **the same `@qcms/ui` renderer** (import-surface test - preview fidelity is the feature) · interactive answer state, with rule evaluation **in the API** and the visible set projected onto the compiled document by `documentForVisible` from `@qcms/ui` - the portal's own function, so preview and serving share one projection (see the amendment above; the admin evaluates nothing, R2) - so authors walk branches · step prev/next `button`s · reset `button`.
- **version history**: `table` - version, publishedAt, compilerVersion / a2uiSpecVersion / semanticsVersion (`text`, monospace) · view action → read-only render **from stored compiled JSONB** (ADR-18 - network assertion: no draft-preview call on history pages) · side-by-side definition **JSON diff** between selected versions (readable, additions/removals marked textually not color-only).
- **secure links** (form with ≥1 published version): mint `dialog` - expiry `date-picker`, one-time `switch`, batch count `number-field` (≤ documented cap) → result list with copy-URL `button`s · links `table` - state `tag` (active/consumed/expired/revoked), consumption timestamp, revoke action (`dialog` confirm) · batch CSV export `button`.
- **close/reopen**: form-level actions with in-flight-session explanation (R1 taught in copy).

## States (normative)

publish confirm · publish errors (list rendered, nothing persisted) · publish success · preview walking branches (insurance fixture appears/disappears) · history empty (never published) · history multi-version + diff · links empty · links minted (URLs shown, copy feedback) · revoke confirm.

## Interactions

- Publish → `POST /admin/forms/:id/publish` (022) → 422 `PublishError[]` verbatim, or `{version, publishedAt}`.
- Preview → `POST /admin/forms/:id/draft/preview` (022 extension landed by 034; not in the frozen 027 contract) → 011 compiled output → shared renderer; answers stay client-side.
- History → `GET /admin/forms/:id/versions/:v` (022). Mint/list/revoke links → 024 endpoints; CSV export client-side from list data.
- Close/reopen → `POST /admin/forms/:id/close|reopen` (022).

## A11y notes

- Publish-error list entries are links; activation moves focus into the builder target. Preview branch changes follow the portal announcement policy (030) so authors experience what respondents will. Copy-URL confirms via status text (`aria-live` polite). Diff readable without color (± markers).

Signed off: Code Owner, 2026-07-21
