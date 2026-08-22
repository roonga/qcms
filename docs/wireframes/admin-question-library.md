# Wireframe - Admin question library

**Status:** Signed off: Code Owner, 2026-07-21 · **Consumed by:** 032 · **Renders:** 021 (question CRUD/versions/publish/deprecate)

> **Amendment, issue #612 (the detail and the creation screens are screens, not bullets).**
> This file described `/questions/{questionId}` only as a `detail - version timeline`
> bullet and `/questions/new` only as a `New question` `button` plus the `editor form`
> bullet, so nothing here ever said what either route is headed by. That is the shape
> #574 named on version detail and response detail, and the one D1 came from: with no
> inventory naming the entity, a route inherits whatever the parent's chrome happens to
> give it and no reader has a specification to check the screen against. Both routes now
> have inventories of their own below. They stay in this file rather than becoming files of
> their own because all three screens render 021 and one library `form` component, and both
> are reached from the list above. The sections down to the first A11y notes describe the
> **list** screen (`/questions`); each screen below describes itself, and the list's regions
> point at them rather than absorbing them.
>
> The `editor form` bullet stays where it is, because it specifies the one component both
> screens render, and each screen's own Regions below say what that screen adds to it and
> what it locks.

## ASCII sketch - library list + editor

```
┌─ Questions ─────────────────────────────────────────┐
│ [search…]  [status ▾] [type ▾]        [+ New question]
│ ┌─ table ────────────────────────────────────────┐  │
│ │ q_at_fault_accident      Any at-fault accident in the last 3 years?  boolean  v2 ●published
│ │ q_accident_count  How many…          number   v1 ○draft
│ └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
┌─ Edit q_at_fault_accident (v3 draft) ──────────────────────────┐
│ type: boolean (locked)         id: q_at_fault_accident (fixed) │
│ label [Any at-fault accident in the last 3 years?     ]  required [✓]        │
│ help  [                      ]                      │
│ ┌─ constraints (per type) ───────────────────────┐  │
│ └────────────────────────────────────────────────┘  │
│            [Save draft] [Publish v3] [Deprecate…]   │
└─────────────────────────────────────────────────────┘
```

## Regions (normative)

- **list toolbar**: search `text-field` (slug/label text) · status filter `select` (all/draft/published/deprecated) · type filter `select` (7 types) · "New question" `button` (primary), which **navigates to the new-question screen** (`/questions/new`), a route of its own with its own inventory below.
- **list `table`**: columns - questionId (`text`, monospace), label, type, latest version + status `tag` (draft/published/deprecated), updated. Row click → detail. Pagination `[upstream gap]` (compose from `button`s).
  - **Accepted deviation (032, screenshot gate `docs/gates/032/`; Code Owner decision, 2026-07-31):** the **updated** column is not built, and this wireframe stops asking for it. There is no field behind it: `question_versions` records `published_at` only, and `questions.created_at` is the identity's birthday, so nothing in the schema knows when a draft was last edited. The available options were each worse than the omission - labelling a `published_at` column "Updated" would state something false about every draft, and adding an `updated_at` is a `question_versions` schema decision (with a migration, and a question about whether an immutable published version can have one at all) rather than a rendering one. Revisit if a real last-edit timestamp is ever added; recorded on issue #218.
- **row link → the question detail screen** (`/questions/{questionId}`), a route of its own with its own inventory below. The version rail, the rendered preview and the lifecycle actions are **its** regions and are inventoried there, not here: this screen is scoped to the library and lists its questions, and it renders none of them.
- **editor `form`** (rendered by the two screens below, in create mode on `/questions/new` and in edit mode on `/questions/{questionId}`; each screen's Regions say what it adds and what it locks):
  - type picker `select` - **locked after creation** with explanatory `tooltip` ("changing type is a new question - R6").
  - questionId `text` - generated `q_` + slug, displayed prominently, immutable; creation dialog explains immutability.
  - label / help `text-field`s (defaultLocale only at launch) · required `checkbox`. It reads `switch` no longer: the vendored a2-react-aria set has no Switch, and hand-writing one is what ADR-22 forbids, so adding one is a `COMPONENT_GUIDELINES` vendoring in its own right rather than a detail of this screen. The same correction was recorded for the mint dialog's one-time control in `docs/wireframes/admin-publish-preview.md`; this line is the shipped control (`apps/admin/components/questions/question-editor.tsx:238-245`).
  - **constraints panel, per type**: shortText → min/max `number-field` ×2 + pattern `text-field` with live regex feedback; longText → max `number-field`; number → min/max `number-field` + integer `switch`; date → min/max `date-picker` ×2; boolean → none; choice types → **option grid** (task 057, frozen card `plan/admin-theme/ds-option-grid.html`): inline-editable table rows, the label cell being the input itself, optionId as read-only `text` (auto-generated `opt_`, minted once when the row is first NAMED and immutable thereafter - Code Owner ruling 2026-08-06), a ghost add-row, insert points between rows, and one grip per row carrying drag-reorder, Arrow Up/Down reorder and a menu of insert-above / insert-below / remove; multiChoice adds min/max-selected `number-field`s.
  - live Zod validation: 003 error paths render inline at the offending field.
- **lifecycle actions** (a region of the question detail screen below, not of this one): Publish (`dialog` confirm: "becomes pinnable; content frozen") · New version (`dialog`: "creates draft vN+1") · Deprecate (`dialog`: "blocks new pins; existing forms unaffected"). Confirmations teach the rules (032). Which of the three is offered, and against which version, is the detail screen's inventory.

## States (normative)

empty library (+ seed hint: `pnpm qcms:seed-fixtures`) · list filtered-empty · editor new · editor draft-dirty/saved · publish confirm · API errors surfaced friendly (`VERSION_IMMUTABLE`, `QUESTION_ID_REUSED`) · deprecated question viewed (read-only, badge).

## Interactions

- Create → `POST /admin/questions` (021) · edit draft → `PUT .../versions/:v` · publish → `POST .../publish` · new version → `POST .../versions` · deprecate → `POST .../deprecate` · list/detail → `GET`s. No delete exists anywhere (R6).
- Option reorder must keep optionIds stable (032 exit criterion - rules depend on it).

## A11y notes

- Table: proper headers, row action reachable by keyboard. Option editor reorder operable without drag (up/down `button`s). Validation errors `aria-describedby`-linked. Lifecycle `dialog`s trap focus, return focus on close. Status conveyed by text in `tag`s, not color alone.

---

# Screen - question detail (`/questions/{questionId}`)

**Consumed by:** 032 (the screen), 048 (the validation-messages editor), 057 (the option grid), 058 (the preview theme island) · **Renders:** 021 (`GET /admin/questions/{id}`, `GET .../versions/{v}/preview`, `PUT .../versions/{v}`, `POST .../versions`, `POST .../publish`, `POST .../deprecate`), 028 (shared renderer) · **Implemented by:** `apps/admin/app/(shell)/questions/[questionId]/page.tsx` and its rail slot `apps/admin/app/(shell)/@rail/questions/[questionId]/page.tsx`

A route of its own, and a separate screen from the list above. The list is scoped to the
deployment's **library** and lists its questions; this one is scoped to **one question** and
is the whole governance record of it. The inventories below are normative for it; the
sections above are not, except the `editor form` bullet, which specifies the component this
screen renders in edit mode.

**A version is not a route here, and that is worth saying against the form screens it looks
like.** The selected version travels as a `?v=` query on this same route (`:78,120`), so one
question is one screen whichever version is showing, and the `h1` names the question rather
than the version. `/forms/{id}/versions/{v}` is the other shape - a route per version, headed
by the version - and the two are easy to read as one pattern. They are not: a form version is
a frozen published document with a render of its own, while a question version is a row in
a row in this screen's rail and a document in this screen's editor.

Inventory-only, per the format spec's allowance for simple screens: the sketch above already
draws the editor half, and the rest is a rail, a preview and the shared chrome. The screen's
own design is `plan/admin-shell-poc/question-editor-poc.html`, which is what the regions
below describe.

## Regions (normative) - question detail

- **back link**: `Back to questions` -> `/questions` (`:88-90`). There is no `breadcrumb` on this screen; the back link is the whole of its upward navigation.
- **rail** (`QuestionVersionsRail`, `apps/admin/components/questions/question-versions-rail.tsx`, rendered by the parallel route `app/(shell)/@rail/questions/[questionId]/page.tsx`): the 240px track at and above `--bp-sidebar`, a disclosure below it, **beside** the content column and never inside it. Its summary is the **questionId**, and below the boundary while shut it also carries the selected version. It carries **one group** and no divider: this question's versions, newest first, with the **lifecycle actions pinned above them**. Detailed in the two bullets below, which are the rail's regions rather than the column's.
  - **The rail is what the screen's own POC draws** (`plan/admin-shell-poc/question-editor-poc.html`, issue 650). `plan/admin-design-contracts.md` §7 describes the same shape in one sentence ("a question's version list counts as children on the question detail screen") and is the rationale for why it looks like the form rail rather than the authority for its existence: `docs/admin-constraints.md` gives that to the POC. A question's only children are its versions and it has no sibling screens, which is why one group here answers to the same rule that gives a form's rail two.
  - **Three rails, not one component with three modes.** This is a distinct component from `FormSubtreeRail` (which navigates between the routes of a form's subtree) and from `SettingsSectionRail` (which switches a panel of one route). What the three share is the grid column, the 240px width and the `--bp-sidebar` collapse behaviour, and those live in `app/globals.css`.
- **page heading**: **one `h1`, naming the question** - the `questionId` itself, rendered in the id style (`qcms-question-id`), with the **selected version's status `tag`** beside it (`:92-93`). The id is the entity the content belongs to (screen scope rule, `docs/wireframes/README.md`), and it is also what an author pastes into a ticket, so the heading and the citable name are the same string.
- **identity line**: slug · created (an ISO day, formatted on the server so no locale or timezone can shift it on hydration) · the selected version's type (`:44-46,95-99`).
- **lifecycle actions** (`LifecycleActions`, `apps/admin/components/questions/lifecycle-actions.tsx`), **in the rail**, pinned above the version list: a column of up to three full-width `button`s, and which appear depends on the selected version's status - **New version** (secondary, always, and first so the ones below it do not move as an author walks the list), **Publish v{n}** (primary, draft only), **Deprecate v{n}** (danger, published only). Each opens a confirm `dialog` with `role="alertdialog"`.
  - **Above the list rather than below it**, which the POC gives its reason for: the version list is the one thing on this screen that grows without bound, so an action anchored under it would drift further down the rail with every version the question accumulates. The dashed rule belongs to the action block and moves with it.
  - **The confirmations are the teaching surface, not a safety prompt.** None of them asks "are you sure": each states the consequence and the escape hatch, so an author who reads one has the versioning model. Each dialog owns its own submission state and is mounted by the button that opened it, so a refusal keeps it open with the reason inside it and a success closes it.
- **version list** (`nav` named `Versions of {questionId}`, **in the rail**), under a label row carrying `Versions` and a digest (`{n} versions, v{m} published`, or `none published`): an unordered list of **every version the question has ever had, newest first**. Each row is an anchor to `?v={n}` carrying `Version {n}` and a status `tag` on one line, and `Published {date}` or `Never published` on a second; the selected row carries `aria-current="page"`.
  - **A labelled row rather than a heading**, because the rail renders before `<main>` in document order and a heading here would sit above the screen's `h1`.
  - **Anchors, not a `table`**: these rows are navigation, so they work with JavaScript off, they can be opened in a new tab, and a screen reader announces them as the links they are. The list screen's vendored `Table` takes string cells and its rows can only be activated with script, which is the distinction this screen is on the other side of.
  - **It appears once on the screen.** It was a `card` in the content column until issue 650; it is not in both places, because a navigation rendered twice is two lists that can disagree and two sets of links to walk.
- **preview** (inside a `card`): an `h2` `Preview`, then `QuestionPreview` (`apps/admin/components/questions/question-preview.tsx`) - a note sentence, the **preview theme island** (`Preview theme` and `Preview mode` `select`s directly above the surface, starting at the deployment's configured respondent theme in light mode, the selection ephemeral - task 058), and `A2UIStepRenderer` over the document for the selected version (`:138-148`).
  - **The document is compiled by the API**, at `GET /admin/questions/{id}/versions/{v}/preview`, and this screen only renders it: compiling here would put `@qcms/a2ui-compiler` and `@qcms/core` inside the BFF, which is exactly what R2's import-surface test keeps out, and it would need a cast at the boundary. Preview and publish therefore run the same `questionToNode` in the same process and cannot drift (`:19-36`).
  - Typed answers reset when the selected version changes, during render rather than in an effect, so no frame paints the previous version's answers under the new version's controls (`:115-119`).
  - A **warning `alert`** replaces the whole preview when that read failed; the rest of the screen still renders (`page:153-157`).
- **editor** (inside a `card`): an `h2` `Version {n}`, then, in order, the **deprecated note** (a warning-coloured `text`, only for a deprecated version), the **frozen sentence** (only when the selected version is not a draft), and `QuestionEditor` in edit mode (`:162-191`).
  - **A frozen version renders the same form, not a different view**, so an author sees the identical layout whether or not they can type in it and the sentence at the top is what answers "why can I not edit this?" (`:28-32`). Every control takes `isFrozen`, and the manual save note and the Save `button` are absent on that branch (`question-editor.tsx:297-308`; §6's rule that a screen with nothing to save says nothing).
  - The editor is **keyed by question and version**, because switching versions is a client-side navigation of the same route and React would otherwise keep the mounted form: `?v=2` would show v1's document in v2's form (`:176-188`).
  - What the editor holds is the `editor form` bullet above. What this screen adds to it: the type is a **locked `text` line** rather than a picker (`question-editor.tsx:212-216`), and the slug is carried as a hidden field so a rejected save echoes the whole submission back intact rather than losing it (`:156-158`).

## States (normative) - question detail

- **draft version selected** - the editor is editable, Publish and New version are offered, the manual save note and Save draft `button` are present.
- **published version selected** - the editor is frozen with its sentence, Deprecate and New version are offered, no Save control exists.
- **deprecated version selected** - the frozen editor plus the deprecation note, which states that forms already pinned keep working and no collected answer changes.
- **no `?v` in the address, or a `?v` naming no version** - the **newest** version is selected, because an author arriving from the list wants what is current (`:48-58`). This is a default, not a redirect: the address is left as it was.
- **preview unavailable** - the warning `alert` in place of the rendered question; the rail, the editor and the actions are unaffected.
- **draft saved** · **draft rejected** - the error `alert` carries the API's message, field issues render at the offending field, and any issue whose path this form does not render is listed inside the alert rather than swallowed (`question-editor.tsx:160-174,313-331`).
- **lifecycle confirm open** · **published** · **new draft created** (the route redirects to `?v={new}`) · **deprecated** · **lifecycle refused** - the dialog stays open with the reason in it.
- **question read failed** (a non-404 error) - the error `alert` **alone**: no back link, no `h1`, and **no rail**, which the slot answers for itself rather than being told (`lib/server/question-rail.ts` returns nothing when the question cannot be read, so the screen's own alert is the only thing that speaks). Recorded because it is what ships, and because it is the same shape as the version detail screen's failed read and a different one from the response detail screen's, which keeps its chrome. The three are inconsistent today and this file records rather than reconciles it; `#614` is open on the version-detail half of that inconsistency.
- **unknown or malformed question id** - 404 (`:73`).

## Interactions - question detail

- Arrive → the questionId anchor in the list `table`'s identifying cell (`apps/admin/components/questions/questions-table.tsx:90-98`), or a pasted `/questions/{id}?v={n}` link, which is the point of the version being in the address.
- Load → `GET /admin/questions/{id}` (021) for the question and every version, then `GET /admin/questions/{id}/versions/{v}/preview` (021) for the selected version's document (`:71,83`).
- Select a version → a `?v=` navigation on this route, from a row of the rail. The rail and the screen are two React trees rendered from one address and both resolve it through the same `selectVersion` (`lib/questions/version-rail.ts`), so the marked row and the rendered version cannot disagree. The preview is read for the new version.
- Save draft → `saveDraftAction` → `PUT /admin/questions/{id}/versions/{v}` (021), which 409s on a published version. Revalidates this route and the list (`app/(shell)/questions/actions.ts:126-147`).
- Publish → `POST .../publish` · Deprecate → `POST .../deprecate` · New version → `POST .../versions` (021), which creates draft v{n+1} seeded from the latest and **redirects to `?v={new}`** so the author lands on the draft they just made (`actions.ts:159-193`).
- No delete exists anywhere (R6). Nothing on this screen removes a question or a version.

## A11y notes - question detail

- One `h1` per screen, naming the question. The card headings are `h2`s and the editor's sub-panels sit under them, so no level is skipped.
- The version list is a `navigation` landmark named after the question, its rows are links, and the current one carries `aria-current`, so "which version am I looking at" is answerable without reading the address bar. The rail carries no heading at all, because it renders before `<main>` and any heading in it would sit above the screen's `h1`.
- Status is conveyed by text inside `tag`s, not by colour alone, in the heading row and on every version row.
- Lifecycle `dialog`s are `alertdialog`s: react-aria supplies the focus trap and returns focus to the trigger on close, and a refusal leaves focus inside the dialog with the reason.
- Validation errors are `aria-describedby`-linked at the field that caused them; an issue whose path this form does not render is announced in the alert instead of disappearing.

---

# Screen - new question (`/questions/new`)

**Consumed by:** 032 · **Renders:** 021 (`POST /admin/questions`) · **Implemented by:** `apps/admin/app/(shell)/questions/new/page.tsx`

A route of its own, and the **only** screen in the app where a question's slug and type can
be chosen. Both are one-way doors - an id is permanent and never reused for a different
meaning, and a type change is a different answer shape and therefore a different question
(R6) - so this screen says so beside each field rather than leaving an author to discover it
from a `QUESTION_ID_REUSED` error later (`:11-23`).

The inventories below are normative for it; the sections above are not, except the
`editor form` bullet, which specifies the component this screen renders in create mode.
Inventory-only: it is one card holding one form.

## Regions (normative) - new question

- **back link**: `Back to questions` -> `/questions` (`:30-32`).
- **page heading**: one `h1`, `New question` (`questions.create.title`) (`:33`). It names what the screen makes, which is the only entity it has: there is no question yet for it to be headed by.
- **editor `card`**: `QuestionEditor` in create mode over a blank `shortText` definition at version 1 (`:37-43`). Its create-only regions, in order (`question-editor.tsx:177-216`):
  - **slug `text-field`** (required), hinted with the shape a slug takes.
  - **id callout**: a small labelled block reading `Question ID`, then the `q_` id the slug has minted so far (or a prompt to type a slug), then the sentence saying the id is permanent. It is prose, not a disabled field: there is nothing here to fill in.
  - **type `select`** over the seven question types, with the note explaining that the choice is locked after creation.
  - Then the shared body - label and help `text-field`s, the required `checkbox`, the option grid for the choice types, the constraints panel for the chosen type, the validation-messages editor, and the boolean labels editor - all as the `editor form` bullet above specifies.
  - **manual save note** and a primary **`Create draft`** `button`, in that DOM order so a linear read reaches the note on the way to the control (§6, `question-editor.tsx:289-308`).
- **rejection `alert`**, above the fields, carrying the API's message and any issue whose path this form does not render (`question-editor.tsx:160-174`).
- **No version rail, no preview, no lifecycle actions.** There is nothing to version, nothing to render and nothing to publish until the draft exists; all three are the detail screen's, and this screen redirects there the moment it succeeds.

## States (normative) - new question

- **blank editor** - the default `shortText` definition, the id callout showing its "enter a slug" prompt.
- **slug typed** - the id callout shows the `q_` id the slug mints, updated as the author types, from the same pure function the action uses.
- **type changed** - the constraints panel, the messages editor and the option grid swap to the ones that type has; a type with no constraints says so rather than showing an empty panel.
- **create rejected** - the alert, with the submitted document still in the form. The whole point of the action shape is that a rejection does not throw the author's work away.
- **create in flight** - the submit `button` disabled.
- **created** - the library is revalidated and the browser lands on `/questions/{id}?v=1`.

## Interactions - new question

- Arrive → the `New question` `button` in the list toolbar, or the empty library's CTA.
- Create → `createQuestionAction` → `POST /admin/questions` (021), which creates the question identity **and its draft v1 in one call** → `revalidatePath("/questions")` → redirect to `/questions/{id}?v=1` (`app/(shell)/questions/actions.ts:100-122`).
- This screen makes no read of its own. It calls `requireAdminSession()` even though the `(shell)` layout already did, so the guarantee is local to the file rather than inherited from a layout the route could later be moved out of (`:19-22`).
- Nothing here publishes. A new question is a draft, and publishing it is the detail screen's.

## A11y notes - new question

- One `h1`, naming the screen.
- The id callout is read as text beside the slug field, so a screen reader hears what the slug will mint without meeting a control that cannot be operated.
- The slug and type notes are field descriptions rather than prose elsewhere on the page, so the rule arrives with the control it governs.
- Validation errors are `aria-describedby`-linked at the offending field; anything the form cannot place is read out in the alert.
- The manual save note precedes the button in DOM order, so the save model is reached on the way to the control rather than after it.

Signed off: Code Owner, 2026-07-21
