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
>
> **Amendment, task 058 (the island landed).** The container now carries the ADR-38 scope
> attribute plus a theme attribute and a mode class, and **two controls sit directly above
> it** (`Preview theme`, `Preview mode`) - a new Region on this screen, on the question
> detail screen and on the published-version screen alike, because all three render through
> the same island component. Its starting state is the deployment's configured respondent
> theme in light mode, and the selection is ephemeral (no persistence; the "Out of scope"
> section of the task names that deliberately). One State is worth recording because it is
> visible and accepted rather than fixed: a dropdown or calendar opened inside the preview
> is portalled to the page body, so it renders in the app's own chrome rather than in the
> previewed theme. `docs/gates/058/README.md` states it in an operator's terms.
>
> **Amendment, issue #574 (the version detail is a screen, not a region).** This file
> described `/forms/{id}/versions/{v}` only as a "view action" inside the version-history
> region, so nothing here ever said what that route is headed by. That silence is the
> structural cause of D1: with no inventory naming the entity, the implementation inherited
> the parent's header and headed the route with the form's slug (#510, fixed in PR #539).
> The route now has an inventory of its own below, checkable against the screen scope rule
> in `docs/wireframes/README.md`. It stays in this file rather than becoming a file of its
> own because it shares these API slices and this renderer, and it is reached by an action
> on the screen above. Everything from the sketch down to the first A11y notes describes the
> publish, preview, history and links screens; the new section describes the version detail
> screen, and the version-history region points at it rather than absorbing it.

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
- **version history**: `table` - version, publishedAt, compilerVersion / a2uiSpecVersion / semanticsVersion (`text`, monospace) · view action → **navigates to the version detail screen** (`/forms/{id}/versions/{v}`), which has its own inventory below (`apps/admin/components/forms/version-history.tsx:109`) · side-by-side definition **JSON diff** between selected versions (readable, additions/removals marked textually not color-only), compared from the **stored frozen definitions** read one per listed version (ADR-18 - network assertion: no draft-preview call on history pages; `apps/admin/app/(shell)/forms/[formId]/versions/page.tsx:21-25,42-48`). This screen is scoped to the form and lists its versions; it renders none of them.
- **secure links** (form with ≥1 published version): mint `dialog` - expiry `date-picker`, one-time `switch`, batch count `number-field` (≤ documented cap) → result list with copy-URL `button`s · links `table` - state `tag` (active/consumed/expired/revoked), consumption timestamp, revoke action (`dialog` confirm) · batch CSV export `button`.
- **close/reopen**: form-level actions with in-flight-session explanation (R1 taught in copy).

## States (normative)

publish confirm · publish errors (list rendered, nothing persisted) · publish success · preview walking branches (insurance fixture appears/disappears) · history empty (never published) · history multi-version + diff · links empty · links minted (URLs shown, copy feedback) · revoke confirm.

## Interactions

- Publish → `POST /admin/forms/:id/publish` (022) → 422 `PublishError[]` verbatim, or `{version, publishedAt}`.
- Preview → `POST /admin/forms/:id/draft/preview` (022 extension landed by 034; not in the frozen 027 contract) → 011 compiled output → shared renderer; answers stay client-side.
- History → one `GET /admin/forms/:id/versions/:v` (022) per listed version, for the diff's frozen definitions; a version whose read fails is absent from the diff rather than failing the screen. The view action is a **navigation**, not a read: the render belongs to the version detail screen below. Mint/list/revoke links → 024 endpoints; CSV export client-side from list data.
- Close/reopen → `POST /admin/forms/:id/close|reopen` (022).

## A11y notes

- Publish-error list entries are links; activation moves focus into the builder target. Preview branch changes follow the portal announcement policy (030) so authors experience what respondents will. Copy-URL confirms via status text (`aria-live` polite). Diff readable without color (± markers).

---

# Screen - version detail (`/forms/{id}/versions/{v}`)

**Consumed by:** 034 (the screen), 058 (the preview theme island) · **Renders:** 022 (`GET /admin/forms/:id/versions/:v`), 028 (shared renderer) · **Implemented by:** `apps/admin/app/(shell)/forms/[formId]/versions/[version]/page.tsx`

A route of its own, and a separate screen from the version history above. The history screen
is scoped to the **form** and lists its versions; this one is scoped to **one version** and
renders it. The inventories below are normative for it; the sections above are not.

Inventory-only, per the format spec's allowance for simple screens: the screen is the shared
form chrome plus one rendered step, and both are sketched elsewhere.

## Regions (normative) - version detail

- **`breadcrumb`**: Forms > the form's slug > Versions. The form is this screen's **context**, not its subject, which is what the breadcrumb is for (screen scope rule, `docs/wireframes/README.md`). Rendered by the shared `FormPageHeader` (`apps/admin/components/forms/form-page-header.tsx:45-53`), so the last crumb names the section rather than the version.
- **page heading**: **one `h1`, naming the version** - `Version {n}` (`forms.history.versionHeading`), passed by the route as a heading override (`.../versions/[version]/page.tsx:55-58`). Not the form's slug: two versions of one form are two screens, and a heading naming the form would give them the same one. The `h1` carries the id `VERSION_HEADING_ID` and `tabIndex={-1}`, so the body can be labelled by it and it can be a focus destination (`form-page-header.tsx:56-62`).
  - **The shipped render does not match this yet.** On the first step of a version the stored compiled document contributes a **second** `h1` carrying the form's title, because the compiler emits the form title as an `h1` on the first step (`packages/a2ui-compiler/src/step-resolver.ts:46-49,61-63`). That is **issue #537**, open. This entry states what the heading should be; it is not a description of what renders today.
- **identity line**: `formId` and open/closed status `text`, shared with every other form section (`form-page-header.tsx:63-68`).
- **section `tabs`**: the form's section nav (`FormTabs`), with Versions current.
- **back link**: `Back to version history` -> `/forms/{id}/versions` (`.../versions/[version]/page.tsx:60-62`).
- **version body** (`VersionView`, `apps/admin/components/forms/version-view.tsx`): a `section` labelled by the page `h1` rather than repeating it (`:103-107`). It contains, in order:
  - **provenance `text` lines**: which stored version this is, the read-only sentence (read-only means the **definition** is immutable, not that the controls are inert), and the compiler / a2ui spec stamps (`:108-119`).
  - **step position `text`**: step *i* of *n*, naming the `stepId` (`:125-131`).
  - **preview theme island**: `Preview theme` and `Preview mode` `select`s sitting directly above the rendered surface, starting at the deployment's configured respondent theme in light mode; the selection is ephemeral (task 058; `apps/admin/components/preview-theme-island.tsx:98-134`).
  - **rendered step**: `A2UIStepRenderer` over the version's **stored** compiled documents, inside the `qcms-preview-surface` container that owns the styling boundary (ADR-18; `version-view.tsx:133-140`). Controls are live rather than disabled, because a greyed, unfocusable copy is not what a respondent saw; nothing is posted and nothing persists, and switching version resets both the answers and the step index (`:65-92`).
  - **step prev/next `button`s**, disabled at the ends (`:142-163`).

## States (normative) - version detail

- **version rendered, first step** - the state in which #537's second `h1` is present.
- **version rendered, a later step** - prev enabled, and the form-title heading is absent, because the compiler emits it on the first step only.
- **version with no stored documents** - the body renders an explanatory `text` in place of the step, the island and the step `button`s (`version-view.tsx:121-123`).
- **answers entered while reading** - controls hold values; nothing is submitted and nothing is stored.
- **theme or mode changed** - the surface re-renders under the chosen respondent theme. A dropdown or calendar opened inside it portals to the page body, so its popover renders in the admin's own chrome rather than in the previewed theme (task 058 amendment above): visible, accepted, and recorded rather than fixed.
- **version read failed** (a non-404 error from the version read) - the route returns the error `alert` **alone**: no breadcrumb, no `h1`, no tabs, no back link (`.../versions/[version]/page.tsx:40-45`). The same holds for a failed form read (`:36-39`). Recorded because it is what ships, and because it is a different shape from the one this file's sibling names for its own failed list read.
- **version not found, or a version segment that is not a positive integer** - 404 (`:29,41`).

## Interactions - version detail

- Arrive → the view action in the history `table` (`version-history.tsx:109`). The screen is also directly addressable, which is the point of its being a route.
- Load → `GET /admin/forms/:id` and `GET /admin/forms/:id/versions/:v` (022), in parallel (`.../versions/[version]/page.tsx:31-34`). **No `POST /admin/forms/:id/draft/preview` from this route at all** (ADR-18): what it shows must be what was served, and a recompilation could only weaken that. Asserted at the network level in the browser suite.
- Step prev/next, answer entry, theme and mode selection → client-side only, no request.
- Back link → `/forms/{id}/versions`.

## A11y notes - version detail

- One `h1` per screen, naming the version. The body `section` is labelled by it (`aria-labelledby`) instead of restating it as an `h2`, so the outline has a single answer to "what is this page".
- The `h1` is a programmatic focus destination (`tabIndex={-1}`), which is why the id travels with the text.
- **Known divergence:** the second `h1` from the stored document on the first step (#537) gives a screen-reader user two competing answers to that question, and makes level-based heading queries ambiguous on this route. Named here so the inventory is not read as endorsing it.

Signed off: Code Owner, 2026-07-21
