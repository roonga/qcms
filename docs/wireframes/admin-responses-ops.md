# Wireframe - Admin responses, erasure, webhook operations

**Status:** Signed off: Code Owner, 2026-07-21 · **Consumed by:** 035 · **Renders:** 023 (responses/export/erase), 024 (webhook config), 025 (delivery state, redeliver)

> **Amendment, issue #574 (the response detail is a screen, not a bullet).** This file
> described `/forms/{id}/responses/{sessionId}` only as a `detail` bullet inside the browser
> inventory, so nothing here ever said what that route is headed by. That silence is the
> structural cause of D1: with no inventory naming the entity, the implementation inherited
> the parent's header and headed the route with the form's slug (#510, fixed in PR #539).
> Note the sketch below already heads the detail with the session id, so the file's
> illustrative half had the right instinct and its **normative** half was the one that was
> silent, which is the half that binds. The route now has an inventory of its own below,
> checkable against the screen scope rule in `docs/wireframes/README.md`. It stays in this
> file rather than becoming a file of its own because it shares these API slices and is
> reached from the browser above. The erasure door and the tombstone moved into it, because
> both are regions of that screen; the erasure **log** stays here, since it is its own route
> (`/responses/erasures`).

## ASCII sketch - two screens: response browser, response detail

```
┌─ Responses: Vehicle insurance ─────────────────────────┐
│ [version ▾] [date range] [flagged ▾]     [Export ▾] │
│ ┌─ table ────────────────────────────────────────┐  │
│ │ ses_a1…  v3  2026-07-18 14:02  link   ⚑flagged │  │
│ │ ses_b2…  v3  2026-07-18 15:11  anon            │  │
│ └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
┌─ ses_a1… ───────────────────────────────────────────┐
│ locked answers        │ ledger (audit timeline)     │
│ Any at-fault accident in the last 3 years? Yes │ 14:01 q_at_fault_accident = true       │
│ At-fault accidents: 2  │ 14:01 q_accident_count = 2     │
│ contentHash: ab3f…    │ 14:02 ── submitted ──       │
│ [Erase respondent data…]                            │
└─────────────────────────────────────────────────────┘
```

## Regions (normative)

- **browser toolbar**: version `select` · date range `date-picker` ×2 · flagged `select` · Export `menu` (CSV - version required; JSON).
- **browser `table`**: sessionId, formVersion, submittedAt, accessMode, flagged `tag`, answer preview. Pagination `[upstream gap]`. Each row's sessionId is a link → **the response detail screen**, a route of its own with its own inventory below (`apps/admin/components/ops/response-browser.tsx:272-280`).
- **erasure log** (its own route, `/responses/erasures`): `table` of tombstones (023 `GET /admin/erasures`) - compliance evidence. The erasure **door** is not here: it is a region of the response detail screen, inventoried below.
- **export UI**: format choice, version `select` (required for CSV, disabled-with-hint for JSON), date range; streams the download; empty-result message.
- **webhook config** (per form): create `dialog` - url `text-field` (https enforced outside dev), active `switch`; **secret shown exactly once** on creation (`alert` + copy `button`, "will not be shown again"); list `table` with masked secrets, rotate (new secret shown once) and deactivate actions.
- **delivery dashboard**: recent deliveries `table` - status `tag`, attempts, latency · **dead-letter list** - lastError, attempt history, per-item **redeliver** `button` + bulk redeliver · delivery detail (`accordion`): request headers (signature masked), response code/body snippet.

## States (normative)

no responses · filtered-empty · list read failed (the error alert, the heading and the toolbar; no count, no table, no empty-state panel and no pager, because each of those is a claim about rows that were not read) · filter value ignored (the address carried a value no filter accepts: it is named on screen and not applied, so it does not choose the empty state - whichever filters did parse decide that, and none of them parsing is what makes the unfiltered one true) · flagged present · export empty-result · webhook none configured · secret-reveal (one-time) · deliveries healthy · dead-letters present · redeliver in-flight/succeeded.

## Interactions

- List → `GET /admin/forms/:id/responses` (023) · row link → the response detail screen (a navigation; its reads and its writes are inventoried below) · export → `GET .../export?format=&version=&from=&to=` (023, streamed) · erasure log → `GET /admin/erasures` (023) · webhook CRUD → 024 · redeliver → `POST .../redeliver` (025).
- Post-erasure the session must vanish from list/detail/export and appear in the log (035 exit criterion 2). An invariant across both screens, which is why it is stated here as well.

## A11y notes

- One-time secret reveal announced assertively; masked thereafter. Redeliver outcomes announced via `aria-live`. Flag/status `tag`s carry text, not color alone. (The type-to-confirm `dialog` and the ledger timeline are the detail screen's, and their notes moved with them.)

---

# Screen - response detail (`/forms/{id}/responses/{sessionId}`)

**Consumed by:** 035 · **Renders:** 023 (response read, erase, unflag, erasure log), 022 (`GET /admin/forms/:id/versions/:v` for captions) · **Implemented by:** `apps/admin/app/(shell)/forms/[formId]/responses/[sessionId]/page.tsx`

A route of its own, and a separate screen from the browser above. The browser is scoped to
the **form** and lists its responses; this one is scoped to **one response** and is the
audit view of it. The inventories below are normative for it; the sections above are not.

The sketch above already draws this screen (the second box, headed `ses_a1…`); it is
illustrative, and the inventories here are what binds.

## Regions (normative) - response detail

- **`breadcrumb`**: Forms > the form's slug > Responses. The form is this screen's **context**, not its subject (screen scope rule, `docs/wireframes/README.md`). Rendered by the shared `FormPageHeader` (`apps/admin/components/forms/form-page-header.tsx:45-53`), so the last crumb names the section rather than the response.
- **page heading**: **one `h1`, naming the response** - `Response {sessionId}` (`ops.detail.heading`), passed by the route as a heading override on **both** of its branches, the live response and the tombstone (`.../responses/[sessionId]/page.tsx:71,94,112-121`). Not the form's slug: two responses of one form are two screens, and the slug gave them the same heading (#510). It carries the id `RESPONSE_HEADING_ID` and `tabIndex={-1}` (`form-page-header.tsx:56-62`). An erased session is still the session an operator has in a ticket, so its tombstone takes the same heading.
- **identity line** and **section `tabs`**: `formId`, open/closed status, and the form's section nav with Responses current (`form-page-header.tsx:63-69`).
- **back link**: `Back to responses` -> `/forms/{id}/responses`, on both branches (`.../responses/[sessionId]/page.tsx:73-75,96-98`).
- **detail body** (`ResponseDetail`, `apps/admin/components/ops/response-detail.tsx`): a `section` labelled by the page `h1` rather than repeating it (`:191-199`). It contains, in order:
  - **action feedback `alert`s**: the erasure outcome (error or success) and the unflag outcome. Deliberately **not** a live region here: the erasure revalidates the route and this subtree unmounts, taking any region with it, so the announcement is made into the shell's region instead and these alerts exist to put the message beside the state that produced it (`:201-214`, issue #355).
  - **summary `dl`**: submitted-at, form version, access mode (with a link to the Links tab when the session came in on a secure link), contentHash as copyable `text` plus the sentence saying what it anchors, and the flag state (`:300-338`).
  - **flag panel** (flagged sessions only): the reason, the sentence explaining that a webhook event is being withheld, and a `button` opening the **unflag confirm `dialog`** (`role="alertdialog"`) (`:216-236,257-284`).
  - **captions-unresolved `alert`** (`warning`): shown when the response's own form version could not be read, so the answers are captioned by id (`:237`).
  - **locked answers**: `h2` "Locked answers", an intro sentence, then a `dl` of one row per pinned question. Captions come from **the version the response was submitted on**, not the newest, so a republished, reworded form does not retro-caption an older submission (`:343-368`; the rule is stated and unit-tested in `apps/admin/lib/ops/labels.ts`). Unanswered and empty-string answers are named in words rather than left blank (`:392-410`).
  - **ledger timeline**: `h2` "Answer ledger", an intro sentence, then an ordered list of every recorded revision with its timestamp and whether the value was answered or cleared - the audit view, matching `answerLedger` exactly (035 exit criterion) (`:425-466`). Empty ledgers say so.
  - **erasure door**: "Erase respondent data" `button` (danger) → **type-to-confirm `dialog`** (`role="alertdialog"`) carrying the three ADR-17 sentences (irreversible, the tombstone remains, webhook consumers are unaffected), a reason `text-field`, and a confirm `text-field` that requires typing the sessionId exactly. There is no single-click path (035 exit criterion) (`:240-251,489-551`).
  - **tombstone `card`**: replaces the summary, answers, ledger and erasure door once the session is erased - `h2`, an explanatory sentence, and a `dl` of sessionId, form version, erased-at and reason (`:253-255`; `apps/admin/components/ops/tombstone-card.tsx:51-78`).

## States (normative) - response detail

- **submitted response** - summary, answers, ledger, erasure door.
- **flagged response** - the flag panel above the answers, with the unflag action.
- **erased response (tombstone)** - reached both by opening the URL of an already-erased session and by erasing in place; the heading, breadcrumb, tabs and back link are unchanged, and the body is the tombstone.
- **captions unresolved** - the version read failed, the warning `alert` shows, and the answers are captioned by questionId. The screen still renders: an id is honest, and an unopenable audit view is worse than an unlabelled one.
- **response read failed** (a non-404 error) - the breadcrumb, `h1`, identity line, tabs and back link **stay**, and the error `alert` replaces the body (`.../responses/[sessionId]/page.tsx:54-83`). Worth noting against the version detail screen's failed read, which drops the chrome instead; the two are inconsistent today and this file records rather than reconciles it.
- **unknown session with no tombstone** - 404. A `RESPONSE_NOT_FOUND` is checked against the erasure log first, because a URL from a ticket is most often an erased session rather than a wrong one (`:59-63,158-172`).
- **erase confirm (typed)** · **erase succeeded** · **erase found the session already erased** · **erase failed** (the alert, the session unchanged).
- **unflag confirm** · **event released** · **nothing to release** · **unflag failed**.

## Interactions - response detail

- Arrive → the sessionId link in the browser `table` (`response-browser.tsx:272-280`). Directly addressable, which is the point of its being a route.
- Load → `GET /admin/forms/:id` and `GET /admin/forms/:id/responses/:sessionId` (023) in parallel, then, for captions, `GET /admin/forms/:id/versions/:v` for **the response's own version** and one question read per distinct pin - not the whole library, which would cost a read per question in the deployment to open one response (`.../responses/[sessionId]/page.tsx:45-48,85,123-156`).
- Erase → the type-to-confirm `dialog` → `POST /admin/forms/:id/responses/:sessionId/erase` (023, form-scoped by #305) → the route revalidates and the same URL renders its tombstone.
- Unflag → the confirm `dialog` → `POST /admin/forms/:id/responses/:sessionId/unflag` (023, form-scoped by #305).
- Tombstone lookup on a missing response → the erasure log filtered by form (023 `GET /admin/erasures`), a lookup rather than a listing.
- Back link → `/forms/{id}/responses`.

## A11y notes - response detail

- One `h1` per screen, naming the response, on both the live and the erased branch. The body `section` is labelled by it (`aria-labelledby`) instead of restating it, and the sub-sections are `h2`s, so no level is skipped (#511).
- The `h1` is the focus destination after an in-place action, which is why the id travels with the text.
- Action outcomes are announced through the shell's live region, which survives the route revalidation, rather than through a region inside the subtree that the revalidation unmounts (#355). Two live regions holding the same sentence would say it twice.
- The type-to-confirm `dialog` labels its required input with the exact string to type, and the mismatch is announced.
- The ledger is an ordered list: the chronology is in the text, not in the layout.
- Flag and status `tag`s carry text, not color alone.

Signed off: Code Owner, 2026-07-21
