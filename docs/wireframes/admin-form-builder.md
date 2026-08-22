# Wireframe - Admin form builder + condition editor

**Status:** Signed off: Code Owner, 2026-07-21 · amended 2026-08-01 (PO seat: kernel moves server-side, see below) · **Consumed by:** 033 · **Renders:** 022 (drafts, validate), 021 (library reads), 005 (`analyzeRuleGraph`, server-side inside validate)

> **Amendment, 2026-08-01 (PO seat).** This wireframe originally placed `analyzeRuleGraph` and the test bench's evaluator **client-side**. Landed enforcement forbids it: rule 1 of `apps/admin/lib/server/r2-import-surface.test.ts` bans `@qcms/core` imports in the admin, and that test stands. Both now run in the API. `analyzeRuleGraph` needed no new route (the kernel's `compileDraft`, which `draft/validate` runs, already includes it); the bench gets `POST .../draft/preview-condition`. The instant pre-round-trip target flag is pure draft geometry (`eligibleTargets`), not a kernel call. Nothing about the layout, regions or states changes.

> **Amendment, issue #612 (the form library is a screen, not a breadcrumb).** `/forms` is
> a shipped route and appeared in no inventory in this folder at all: this file named it
> only as the first crumb of the builder's `breadcrumb`, which says where the builder sits
> and nothing about what `/forms` is. That is the silence #574 found on version detail and
> response detail, one step further out - a route with no inventory cannot be checked
> against the screen scope rule in `docs/wireframes/README.md`, so nothing was in a
> position to notice if it drifted. It has an inventory of its own below. It stays in this
> file rather than becoming a file of its own because it renders 022's form slices, it is
> where the builder's breadcrumb roots, and its one creating action redirects into the
> builder above. Everything from the sketch down to the first A11y notes describes the
> builder; the new section describes the library.

## ASCII sketch

```
┌─ Forms / Vehicle insurance / Builder ──────────[Publish ▸]─┐
│ ┌─ steps ──────┐ ┌─ step: Driving history ──────────────────────┐│
│ │ 1 Drv hist ● │ │ q_at_fault_accident      @v2  [move pin ▾] [×] ││
│ │ 2 Lifestyle  │ │ q_accident_count  @v1  [move pin ▾] [×] ││
│ │ [+ add step] │ │ [+ add question from library]       ││
│ └──────────────┘ └─────────────────────────────────────┘│
│ ┌─ conditions (rul_accident_followup) ──┐ ┌─ validation ─┐│
│ │ { "op":"equals",                    │ │ ✓ no issues  ││
│ │   "questionId":"q_at_fault_accident", … }      │ │              ││
│ │ show: [q_accident_count ▾]              │ └──────────────┘│
│ └─────────────────────────────────────┘                 │
│ ┌─ settings ─┐ ┌─ test bench ─┐        saved ✓ 12:03    │
└─────────────────────────────────────────────────────────┘
```

## Regions (normative)

- **header**: `breadcrumb` (Forms / {form} / Builder) · Publish `button` (primary - hands off to 034's flow) · save indicator (`text`: saved/dirty/saving + timestamp; autosave per 022 advisory semantics).
- **steps rail**: ordered step list (title, active indicator, per-step issue count `tag` when validation issues exist) · add step `button` · rename/reorder/remove via row `menu`. Reorder keyboard-operable.
- **step editor**: per-question row - questionId@version (`text`, monospace) · "move pin" `menu` listing available published versions (no auto-upgrade, no bulk - R7) · remove `button`. Add-question opens **library picker** `dialog`: search + `table` of published versions only, deprecated flagged (`tag`) and excluded for new pins (022). Duplicate-question-in-form prevented in UI.
- **condition editor** (per rule; rules listed with add/remove):
  - schema-aware JSON editor - **CodeMirror** (the recorded ADR-22 exception) with autocomplete for `op` (incl. `contains`/`containsAny` - ADR-21), `questionId` (pinned questions only), `optionId` (from the referenced question's pinned version).
  - `show` target picker `select` (multi) - pre-filtered to questions/steps **after** the rule's referenced questions via client-side `documentOrder` (teaches ADR-16 before publish rejects).
- **validation panel**: live `PublishError[]` from debounced `POST .../draft/validate` (022), which already carries the kernel's `analyzeRuleGraph` findings (`RULE_BACKWARD_TARGET`, `RULE_CYCLE`), plus the instant target-eligibility flag the picker raises from `eligibleTargets` before the round trip; each entry anchored - click scrolls/focuses the offending rule/step/question via the structured `path`.
- **test bench** (collapsible `accordion`): pick a rule → enter hypothetical answers for its referenced questions (controls per type) → match/no-match result (`text`), clearly labeled read-only preview.
- **settings panel** (`accordion`): `challengeRequired` `switch` - inline warning `alert` when enabled with deployment provider `none` (ADR-24) · min-time floor `number-field` (026).
- **agent panel** (flag-conditional): see `admin-agent-panel.md` - docked right of the builder.

## States (normative)

new empty form · draft with issues (advisory - saving allowed, publish blocked) · draft clean · saving/saved/save-failed · backward-target attempt (instant client flag + validate-endpoint error if force-saved) · pin-move invalidates a rule's optionId (error surfaces at the rule) · concurrent-edit last-write-wins warning `alert`.

## Interactions

- Autosave → `PUT /admin/forms/:id/draft` (022; response carries `{draft, issues}`) · debounced validate → `POST .../draft/validate` · library reads → `GET /admin/questions*` (021) · Publish → 034's flow.
- Editor must never emit DSL the schema rejects (033 exit criterion - pickers are fuzzed).

## A11y notes

- Validation entries are links; activating one moves focus to the target control. CodeMirror region labeled; all pickers offer the keyboard path (no drag-only interactions). Issue counts announced on change via `aria-live` (polite). Rail reorder via menu commands, not drag.

---

# Screen - the form library (`/forms`)

**Consumed by:** 033 · **Renders:** 022 (`GET /admin/forms`, `POST /admin/forms`) · **Implemented by:** `apps/admin/app/(shell)/forms/page.tsx`

A route of its own, and a separate screen from the builder above. The builder is scoped to
**one form** and holds its draft; this one is scoped to the **deployment** and lists every
form in it. The inventories below are normative for it; the sections above are not.

Inventory-only, per the format spec's allowance for simple screens: one creating form, one
table, and the shared empty panel. It carries no rail: the §7 rail is the form subtree's,
and this screen is above that subtree rather than in it.

## Regions (normative) - form library

- **page heading**: one `h1`, `Forms` (`forms.title`), with an intro sentence beneath it (`forms.intro`) (`app/(shell)/forms/page.tsx:38-41`). No `breadcrumb`: this is a top-level area reached from the shell nav, and it is the crumb every form-scoped screen roots at rather than a screen that has one.
- **create-form `card`** (`CreateForm`, `apps/admin/app/(shell)/forms/create-form.tsx`): a `form` inside a `card`, its `fieldset` legended `New form`, holding three `text-field`s in one row - slug (required, hinted "lower-case words separated by hyphens"), title ("what a respondent sees at the top of the questionnaire"), default locale (required, defaulting to `en`) - a rejection `alert` above them, and a primary submit `button` that reads `Creating the form...` while the post is in flight (`:52-98`).
  - **the id preview** sits between the fields and the button: the `frm_` id the slug will mint, stated as a sentence before the one-way door is opened, or a prompt to type a slug when there is nothing yet (`:47,86-90`). It is computed by `formIdFromSlug`, the same pure function the action mints the real id with, so the preview cannot drift from the result. This live preview is the one reason the card is a client component.
- **list-read error `alert`**: the form library could not be loaded (`:45-47`). It is not accompanied by a table or an empty panel, because both would be claims about rows that were not read.
- **empty panel** (`EmptyState`, `plan/admin-design-contracts.md` §3): heading `No forms yet`, one sentence, and **no CTA** (`:57-63`). §3 asks for a primary CTA where a creating action exists, and this is the one screen where that is not applied literally: the creating action is the `CreateForm` fieldset rendered directly above rather than a control leading somewhere, and there is no `/forms/new` route for a CTA to point at. The page records the reasoning in place (`:49-56`); it is a stated deviation, not an omission.
- **library `table`** (`FormsTable`, `apps/admin/app/(shell)/forms/forms-table.tsx`): a visually-hidden `caption`, and six columns - slug, form id, locale, status, draft, published (`:47-68`). The **slug** is the identifying cell, a `th scope="row"` carrying a real anchor to the builder whose accessible name is `Open form {slug}` (`:73-81`, §2). The id keeps a column of its own in the id style, because it is the value an operator pastes into a ticket while the slug is what an author names a form by.
  - **status and draft are two columns, not one merged word**, and that is the screen's central claim: "respondents are seeing version N" and "there is unpublished work in the builder" are independent facts, a form can have both, either or neither, and merging them would require inventing a precedence between them (`app/(shell)/forms/page.tsx:20-29`).
  - **published** reads `Never published`, `v{n}`, or `v{n} on {date}`.
  - **Which column drops at compact width: Locale.** Every form in a single-locale deployment carries the same value, so it distinguishes fewest rows; the version column never drops (`plan/admin-mobile-stance.md`, item 5).
- **table hint `text`**: `Open a form from the link in its Slug column.` (`:68`).
- **no filter toolbar and no pagination.** Nothing on this screen filters, searches or sorts: `GET /admin/forms` returns the whole set and the API owns its order, so a second ordering in the BFF would be a decision it has no authority to make (R2). That is a real difference from the question library, whose inventory carries both a toolbar and a pagination `[upstream gap]`, and it is stated here rather than left to be read as an oversight.

## States (normative) - form library

- **no forms** - the create card and the empty panel, no table.
- **forms listed** - the create card, the table and its hint.
- **list read failed** - the error `alert` and the create card; no table, no empty panel and no hint, because each of those is a claim about rows that were not read.
- **create rejected: unusable slug** - the slug yields no id, and the `alert` says so on that field's own terms (`INVALID_FORM_ID`).
- **create rejected: blank default locale** - a different mistake on a different field, kept distinct so an author with an empty locale box is not told their slug is invalid (`actions.ts:137-157`).
- **create rejected by the API** - the returned code's sentence, with the submitted slug, title and locale echoed back into the fields, including on a pre-hydration full POST (`create-form.tsx:37-45`).
- **create in flight** - the submit `button` disabled and relabelled.
- **created** - the library is revalidated and the browser lands on the new form's builder.

## Interactions - form library

- Load → `GET /admin/forms` (022), one call, rendered as it arrives (`lib/server/forms.ts`, `listForms`).
- Create → `createFormAction` → `POST /admin/forms` with `{formId, slug, defaultLocale}` (022) → `revalidatePath("/forms")` → redirect to `/forms/{formId}?title=...` (`app/(shell)/forms/actions.ts:126-167`). **The title is not part of the create call**: `POST /forms` takes an identity, while the title belongs to the definition, so it travels in the query string and the builder's first autosave is what stores it.
- Slug link in a row → the builder for that form. A navigation, not a read.
- Nothing here publishes, closes, reopens or deletes. No delete exists anywhere (R6).

## A11y notes - form library

- One `h1`, naming the screen. The empty panel's heading is an `h2` and is what names the region when the table it replaces is absent (§3).
- The table is a plain `table` with a caption and header cells, not a grid whose row is the control: the identifying cell holds the anchor, so a keyboard user reaches the builder by tabbing to a link rather than by activating a row (§2). `app/(shell)/table-anchors.test.tsx` asserts that by reading the markup.
- The row anchor's accessible name names its destination (`Open form {slug}`) rather than repeating a bare identifier.
- The create form is a real `fieldset` with a `legend`, and the id preview is prose beside the fields rather than a disabled control, so a screen reader hears what the slug will mint without meeting a field that cannot be filled in.

Signed off: Code Owner, 2026-07-21
