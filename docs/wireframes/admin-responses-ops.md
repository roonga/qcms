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

> **Amendment, issue #612 (three more routes get inventories, and two of them are not what
> this file's first half describes).** The sweep #574 asked for found that this file
> describes a **per-form** response browser and a **per-form** webhook screen, while three
> deployment-wide routes stood undistinguished from them:
>
> - **`/responses`** - the Responses area, which appeared nowhere in this folder at all. It
>   is **not** the browser above: it lists **forms**, as a way in, and there is deliberately
>   no cross-form response list.
> - **`/responses/erasures`** - named above as a bullet that at least said it was a route,
>   which is better than D1's silence and still not an inventory anything can be checked
>   against.
> - **`/webhooks`** - the deployment-wide dead-letter queue, described above **inside the
>   per-form delivery dashboard's bullet**, as though the two were one screen. That is the
>   D1 shape exactly: a route of its own appearing as a clause inside another screen's
>   region, so the implementation inherits the parent's assumptions and no reader has a
>   specification saying otherwise.
>
> All three have inventories of their own below, and the regions above point at them rather
> than absorbing them. Two states moved with the queue (`dead-letters present`, `redeliver
> in-flight/succeeded`), because they are states of that screen and of no other. They stay
> in this file rather than becoming files of their own because they render these API slices
> and each is the way into the per-form screen beside it.

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
- **erasure log**: **a route of its own** (`/responses/erasures`) with its own inventory below, reached from the Responses area screen rather than from the browser. A `table` of tombstones (023 `GET /admin/erasures`) as compliance evidence; what it holds, what it refuses to hold and what it does on a failed read are inventoried there. The erasure **door** is not here either: it is a region of the response detail screen, inventoried below.
- **export UI**: format choice, version `select` (required for CSV, disabled-with-hint for JSON), date range; streams the download; empty-result message.
- **webhook config** (per form): create `dialog` - url `text-field` (https enforced outside dev), active `switch`; **secret shown exactly once** on creation (`alert` + copy `button`, "will not be shown again"); list `table` with masked secrets, rotate (new secret shown once) and deactivate actions.
- **delivery dashboard** (per form): recent deliveries `table` - status `tag`, attempts, latency · delivery detail (`accordion`): request headers (signature masked), response code/body snippet. Rendered by `apps/admin/components/ops/delivery-dashboard.tsx`, which nothing outside `/forms/{id}/webhooks` renders.
  - **The dead-letter list is not here.** It is the whole subject of a **route of its own** (`/webhooks`) with its own inventory below, and the API is why: `GET /admin/outbox/dead-letters` is deployment-wide, because a stuck delivery is an operational fact about the deployment rather than about one form. Configuration and delivery history are per form and stay on this screen; the queue, its per-item and bulk **redeliver** controls and its `lastError` column belong to the other one (`apps/admin/components/ops/dead-letters.tsx`, rendered only by `apps/admin/app/(shell)/webhooks/page.tsx`).

## States (normative)

no responses · filtered-empty · list read failed (the error alert, the heading and the toolbar; no count, no table, no empty-state panel and no pager, because each of those is a claim about rows that were not read) · filter value ignored (the address carried a value no filter accepts: it is named on screen and not applied, so it does not choose the empty state - whichever filters did parse decide that, and none of them parsing is what makes the unfiltered one true) · flagged present · export empty-result · webhook none configured · secret-reveal (one-time) · deliveries healthy.

The queue's own states (`dead-letters present`, `redeliver in-flight/succeeded` and the rest) moved to the webhook operations screen below, with the queue, since they are states of that route and of no other (issue #612).

## Interactions

- List → `GET /admin/forms/:id/responses` (023) · row link → the response detail screen (a navigation; its reads and its writes are inventoried below) · export → `GET .../export?format=&version=&from=&to=` (023, streamed) · webhook CRUD → 024. The erasure log's read (`GET /admin/erasures`, 023) and redelivery (`POST .../redeliver`, 025) are the two screens below that own them, and are inventoried there.
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

---

# Screen - the Responses area (`/responses`)

**Consumed by:** 035 · **Renders:** 022 (`GET /admin/forms`) · **Implemented by:** `apps/admin/app/(shell)/responses/page.tsx`

A route of its own, and **not the response browser this file opens with**. The browser is
scoped to **one form** and lists that form's responses; this screen is scoped to the
**deployment** and lists **forms**, as a way in. The two are near-homonyms in the shell nav
and in the address bar, which is exactly why the distinction is written here.

**There is deliberately no cross-form response list**, and it is a decision rather than an
unfinished screen: the API has no route for one, and a client-side merge would hand an
operator a count and a page number that describe nothing the server agrees with
(`:11-16`). So this screen answers "which form's responses" and hands off.

Inventory-only: a heading, a link and a list.

## Regions (normative) - Responses area

- **page heading**: one `h1`, `Responses` (`ops.area.responses.title`), with the intro sentence beneath it that states the model in words - "Responses are held per form. Open a form to browse, export or erase what it collected." (`:23-28`). The `h1` names the area, which is the entity the content belongs to; no form is named on this screen because none is selected yet.
- **erasure-log link**: `Erasure log` -> `/responses/erasures` (`:30-34`). This is the only route the erasure log is reached from, and it is why the log's inventory sits below rather than under the browser.
- **forms-read error `alert`**: the form list could not be loaded (`:36-40`).
- **form list** (`ul`): one link per form, `Open responses for {slug}` -> `/forms/{id}/responses` (`:56-67`).
- **no-forms sentence** (`text`): "No forms exist yet, so nothing has been collected." (`:52-54`).
- **Nothing else.** No `table`, no filters, no date range, no export, no pager, no count: every one of those is the browser's, and offering any of them here would be a claim about responses this screen has not read.

## States (normative) - Responses area

- **forms listed** - the heading, the erasure-log link and the list.
- **no forms** - the sentence in place of the list.
- **forms read failed** - the error `alert` and the erasure-log link, and **no list element at all** (`:41-49`, issue #513). Not an empty `<ul>`: a screen reader reads that as "list, 0 items", which is the same false claim told a different way, and not the no-forms sentence either, because a failed read does not know whether forms exist. Three states, not two.

## Interactions - Responses area

- Load → `GET /admin/forms` (022). One read, and the only one this screen makes.
- Erasure-log link → `/responses/erasures`. Form link → `/forms/{id}/responses`. Both navigations.
- **No action of any kind.** Nothing here reads, writes, exports or erases a response.

## A11y notes - Responses area

- One `h1`, naming the area.
- The three read states are three different elements rather than one element with a fallback value, so nothing on the screen ever states a fact the read did not establish.
- Each form link carries the form's slug in its own text, so the list is usable link-by-link out of context.

---

# Screen - erasure log (`/responses/erasures`)

**Consumed by:** 035 · **Renders:** 023 (`GET /admin/erasures`) · **Implemented by:** `apps/admin/app/(shell)/responses/erasures/page.tsx`

A route of its own, scoped to the **deployment's erasure record**. Not to a form: a
tombstone is evidence about a subject request, and the question it answers ("was this
honoured") is not asked one form at a time.

**A tombstone is what an ADR-17 erasure leaves**: the session id, the form, the version,
when and why. It holds no answers, and that is exactly what makes the log publishable as
evidence - it can be shown to whoever asks whether a request was honoured, without showing
them what was erased (`:13-18`).

Inventory-only: one table and the shared empty panel.

## Regions (normative) - erasure log

- **page heading**: one `h1`, `Erasure log` (`ops.erasures.title`), with an intro sentence beneath it (`:30-33`).
- **back link**: `Back to responses` -> `/responses` (`:35-39`).
- **read error `alert`**: the erasure log could not be loaded (`:48-50`).
- **empty panel** (`EmptyState`, §3): heading `No erasures recorded`, body `Nothing has been erased.`, and **no CTA** - nothing on this screen creates a tombstone, and §3 asks for one only where a creating action exists (`:52-58`).
- **total `text`**: the row count, pluralized (`:62-64`).
- **tombstone `table`**: a visually-hidden `caption`, and five columns - Session (a `th scope="row"` in the id style), Form (id style), Version, Erased (a UTC timestamp), Reason (`:69-105`).
  - The **reason** is rendered as words from a closed vocabulary (data subject request / retention policy / entered in error), with an unrecognised value quoted back inside a sentence rather than printed raw as though it were prose, because the column is free text at the database (`apps/admin/components/ops/ops-tags.tsx`, `ops.erase.reason.unknown`).
  - **Which column drops at compact width: Reason.** Session, Form and Erased-at are how a tombstone is identified and dated as evidence; the reason describes it. The version column never drops (`plan/admin-mobile-stance.md`, item 5).
- **No action of any kind, and that is deliberate rather than unfinished** (`:19-23`). Erasure is performed on the response detail screen, where the operator can see what they are about to destroy; a delete control on a list of ids would be the single-click path 035's exit criterion 2 rules out.

## States (normative) - erasure log

- **tombstones listed** - the total and the table.
- **no erasures** - the empty panel, no table, no total.
- **log read failed** - the error `alert` and **nothing else** (§3, issue #513's rule; `:41-47`). The screen used to fall back to an empty row list and render "Nothing has been erased." underneath the error, which is a claim about compliance evidence the app had just failed to load - on this screen of all screens the wrong thing to say. The empty panel now lives inside the read-succeeded branch, where it can only be reached by having read the log and found it empty.

## Interactions - erasure log

- Arrive → the `Erasure log` link on the Responses area screen. Directly addressable, which is what makes it citable as evidence.
- Load → `GET /admin/erasures` (023). A server component with no client half; there is nothing here to hydrate.
- Back link → `/responses`.

## A11y notes - erasure log

- One `h1`, naming the screen. The empty panel's heading is an `h2` and is what names the region when the table it replaces is gone, so heading navigation lands on "No erasures recorded" where the caption used to be.
- The table has a caption and real header cells, and the session id is the row header.
- Timestamps are rendered in UTC, the same clock the rest of the ops screens use, so two operators reading the same log read the same instant.
- The reason is text, never a colour or an icon alone, and an unknown value is still legible as a sentence.

---

# Screen - webhook operations (`/webhooks`)

**Consumed by:** 035 · **Renders:** 025 (`GET /admin/outbox/dead-letters`, `POST /admin/forms/{formId}/deliveries/{deliveryId}/redeliver`), 022 (`GET /admin/forms`) · **Implemented by:** `apps/admin/app/(shell)/webhooks/page.tsx`

A route of its own, and **not the per-form webhook screen** this file inventories above.
The per-form screen (`/forms/{id}/webhooks`) holds one form's endpoints and one form's
delivery history; this one holds the **deployment-wide dead-letter queue**, plus a way into
each form's configuration.

**The split is the API's shape, not a simplification** (`:16-21`):
`GET /admin/outbox/dead-letters` is global, because a stuck delivery is an operational fact
about the deployment and the operator's question is "is anything stuck", not "is anything
stuck on this one form". Configuration is per form and stays where an author works. The
server actions both screens use live in this route's folder
(`apps/admin/app/(shell)/webhooks/actions.ts`), and the per-form screen imports its CRUD
actions from here, which is worth knowing before reading either screen's file as
self-contained.

Inventory-only: two stacked sections.

## Regions (normative) - webhook operations

- **page heading**: one `h1`, `Webhook operations` (`ops.area.webhooks.title`), with an intro sentence that states the split in words (`:29-34`). The nav item that reaches it is labelled `Webhooks`; the heading is the longer name, and the copy catalog is what the screen actually says.
- **queue-read error `alert`** (`:36-40`).
- **dead-letter queue** (`DeadLetters`, `apps/admin/components/ops/dead-letters.tsx`): a `section` labelled by its own heading, containing, in order:
  - **`h2`** `Dead-letter queue` with an intro sentence (`:121-131`). The `h2` carries `tabIndex={-1}` and is the **focus destination after a completed redelivery**, because both redelivery paths remove the control that started them - the row's own `button`, or the bulk confirmation whose trigger disappears with the last row - so there is nothing to restore focus to (`:85-95`, issue #308).
  - **status region** (`aria-live="polite"`): the redelivery outcome, as a success or error `alert` (`:136-151`).
  - **empty panel** (§3): heading `Nothing dead-lettered`, one sentence, and **no CTA** - nothing on this screen creates a dead letter (a failed delivery does), and an empty queue is the good outcome rather than a gap to fill (`:157-163`).
  - **total `text`** and a secondary **`Redeliver all`** `button`, side by side above the table (`:166-184`).
  - **queue `table`**: a visually-hidden caption and six columns - Event (a `th scope="row"` in the id style), Endpoint (the URL), Attempts, Last error, Dead-lettered (a UTC timestamp), and a per-row **`Redeliver`** `button` in a column whose header text is visually hidden (`:191-253`). **Which column drops at compact width: Last error.** It is the widest cell by a long way (a raw upstream error string) and it describes a failure rather than identifying the delivery; Event, Endpoint, Attempts and Dead-lettered-at are what an operator scans to decide whether to redeliver, and the control travels with them.
  - **bulk confirm `dialog`** (`role="alertdialog"`), which cannot outlive its rows: its only trigger is inside the rows branch, and it is gated on the read having succeeded, so it can never name targets from a queue nobody read (`:260-298`).
- **forms section**: an `h2` `Forms`, a **warning** `alert` when the form read failed (a warning, not an error: the queue above is the screen's subject and it read fine), the no-forms sentence, or a `ul` of links `Configure webhooks for {slug}` -> `/forms/{id}/webhooks` (`:53-85`).

## States (normative) - webhook operations

- **queue clear** - the empty panel; no total, no bulk control, no table.
- **dead letters present** - the total, the bulk `button` and the table.
- **queue read failed** - the error `alert`, the queue's **heading and intro, and nothing else** (`dead-letters.tsx:48-60`, issue 543). The heading stays because the alert needs a subject and a heading claims nothing about the data; the empty panel, the total, the table and both redelivery controls all go, because every one of them either asserts something about rows that were not read or acts on them. The collapsed `ok ? data : []` shape that made a failed read indistinguishable from an empty one is what this state exists to forbid: "nothing is stuck" is the reassuring answer and the false one, on the screen whose whole purpose is answering that question.
- **redeliver in flight** - every redelivery control disabled.
- **redeliver queued** - the success `alert` says **queued for the next pass**, not delivered: `POST .../redeliver` resets the row to due-now and the deliverer's next pass makes the attempt, so a message claiming delivery would be wrong for as long as that pass takes.
- **redeliver partly refused** - both numbers are named in one sentence. "3 queued" beside a table that still has two rows in it is the exact shape an operator misreads as done, and the refused rows are still in the table because the screen re-reads the queue (`dead-letters.tsx:303-315`).
- **redeliver failed** - the error `alert`; nothing was reset.
- **bulk confirm open** - the `alertdialog`, naming the whole visible worklist.
- **forms listed** · **no forms** · **forms read failed** - the same three-states rule as the Responses area screen, for the same reason: on a failure this section renders the warning and no list element at all (`:62-67`).

## Interactions - webhook operations

- Load → `GET /admin/outbox/dead-letters` (025) and `GET /admin/forms` (022), in parallel (`:25`).
- Redeliver one → `redeliverAction` → `POST /admin/forms/{formId}/deliveries/{deliveryId}/redeliver` (025). The **form travels with the delivery** (issue #305): redelivery is form-scoped server-side, so the caller names the form it believes the delivery belongs to and the API refuses the pair if it does not hold. The route is then revalidated (`actions.ts:136-142`).
- Redeliver all → the confirm `dialog`, then **the same call once per visible row**: there is no bulk endpoint, so the loop is the implementation and a partial result is the interesting case, reported as queued and refused separately (`actions.ts:150-168`).
- Form link → `/forms/{id}/webhooks`. A navigation; no endpoint is configured, rotated or deactivated from this screen.
- Nothing here creates, deletes or retries an endpoint, and nothing here reads a secret.

## A11y notes - webhook operations

- One `h1`, with the queue's `h2` and the forms `h2` beneath it; no level is skipped.
- The queue is a `section` named by its own heading, and its outcome messages are rendered inside its `aria-live="polite"` region rather than announced from elsewhere. The region carries its own test id so its absence fails a test rather than passing silently (issue #359).
- Focus lands on the queue's heading after a completed redelivery, because the control that was pressed no longer exists.
- Each row's `Redeliver` `button` carries a visually-hidden accessible name naming the event and the target, while the visible word is `aria-hidden`, so twenty identical "Redeliver" buttons are twenty distinguishable controls to a screen reader.
- The bulk confirmation is an `alertdialog`: react-aria traps focus and returns it on close, and it is not dismissable while a batch is in flight.
- Status and attempt counts are text, never colour alone.

Signed off: Code Owner, 2026-07-21
