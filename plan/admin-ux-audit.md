# Admin UX audit: how far the form-editor design language should travel

**Status:** working analysis, PM/PO seat, 2026-08-18 · **Subject:** every authenticated screen under `apps/admin/app/(shell)/` · **Tested against:** `plan/admin-shell-poc/admin-shell-poc.html`, `plan/admin-shell-poc/rules-screen-poc.html`

Nothing was run. Every claim about current behaviour is read from the source and cited by file and line.

---

## 1. Summary and position

**About a third of this language generalises, a third is form-only, and one element applies to exactly one screen.** The honest split is not "adopt it everywhere" and it is not "keep it in the form editor": the seven elements are three different kinds of thing wearing one name. Elements 4 and 5 (the ownership-aware grid and the row grip menu) are **already a shipped house pattern**, not a form-editor invention: `components/questions/option-grid-editor.tsx` landed them in task 057 from a frozen design card, complete with grip, hairline insert, keyboard reorder and a row menu, and the POC's questions grid is a second instance of the same idea. They should be finished, not adopted. Element 6 (scope discipline) is not a design language at all but a correctness rule, and the shipped app violates it in two places the POC never examined: the version-detail and response-detail routes are headed with the **form's** slug while their content is one version or one response (`components/forms/form-page-header.tsx:35-37` with `lib/i18n/en.ts:432`). Elements 1, 2 and 7 (contextual rail, wide left-anchored column, ambient save status) earn their keep on the form subtree and almost nowhere else: of the sixteen authenticated screens, eight are form-scoped and would get a populated rail, and eight would get an empty one or a rail that duplicates the page's own body. Element 7 is narrower still: exactly one screen in this app autosaves. Element 3 (collapsibles with digests) is the one I would push back on hardest as drawn: the POC's own step screen collapses two sections whose digests count overlapping facts (`Rules . 3 rules . 1 issue` at `plan/admin-shell-poc/admin-shell-poc.html:729-736` beside `Validation . saved 14:02, 2 issues` at `:935-937`), which asks a reader to do arithmetic they cannot check while both are shut. The single highest-value move in this whole audit is not any of the seven: it is that **three different table treatments and two different empty-state treatments already ship side by side**, and a language being adopted is the cheapest moment there will ever be to pick one.

---

## 2. Screen-by-screen verdicts

Verdicts: **adopt** (take as drawn), **adapt** (take the idea, change the form), **reject** (wrong for this screen), **n/a** (nothing to apply it to).

| # | Screen (route) | Scope | Shape | 1 rail | 2 width | 3 collapse+digest | 4 ownership grid | 5 row menu | 6 scope fix | 7 ambient save |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `/questions` | library (all questions) | list | reject | reject | reject | n/a | adapt | n/a (correct) | n/a |
| 2 | `/questions/new` | one new question | form | reject | reject | reject | adopt (already ships) | adopt (already ships) | n/a (correct) | reject |
| 3 | `/questions/[questionId]` | one question, one version | mixed (nav + preview + form) | adapt | reject | adapt (versions only) | adopt (already ships) | adopt (already ships) | n/a (correct) | reject |
| 4 | `/forms` | library (all forms) | list + create | reject | reject | reject | n/a | adapt | n/a (correct) | n/a |
| 5 | `/forms/[formId]` (builder) | one form, all steps | mixed (editor) | **adopt** | **adopt** | **adopt** | **adopt** | adapt (already ships) | adapt (see §3.5) | **adopt** |
| 6 | `/forms/[formId]/preview` | one form's draft | detail (rendered) | adopt | **reject** | reject | n/a | n/a | n/a (correct) | n/a |
| 7 | `/forms/[formId]/versions` | one form, all versions | list + tool | adopt | adopt | adapt (diff only) | n/a | n/a | n/a (correct) | n/a |
| 8 | `/forms/[formId]/versions/[version]` | **one version** | detail (rendered) | adopt | **reject** | reject | n/a | n/a | **adopt (broken today)** | n/a |
| 9 | `/forms/[formId]/links` | one form's links | list + one-time panel | adopt | adopt | **reject** (see §5.2) | n/a | adapt | n/a (correct) | n/a |
| 10 | `/forms/[formId]/responses` | one form's responses | list | adopt | adopt | reject | n/a | n/a | n/a (correct) | n/a |
| 11 | `/forms/[formId]/responses/[sessionId]` | **one response** | detail | adopt | reject | adapt (ledger) | n/a | n/a | **adopt (broken today)** | n/a |
| 12 | `/forms/[formId]/webhooks` | one form's endpoints | mixed (config + dashboard) | adopt | **adopt** | adapt (already ships) | **reject** (see §5.1) | adapt | n/a (correct) | n/a |
| 13 | `/responses` | deployment (index) | index | reject | reject | reject | n/a | n/a | n/a (correct) | n/a |
| 14 | `/responses/erasures` | deployment (log) | list | reject | adapt | reject | n/a | n/a | n/a (correct) | n/a |
| 15 | `/webhooks` | deployment (queue + index) | list + index | reject | **adopt** | reject | n/a | adapt | n/a (correct) | n/a |
| 16 | `/settings` | one account | form | reject | **reject** | reject | n/a | n/a | n/a (correct) | reject |

Counting the rail column: **8 adopt or adapt, 8 reject.** That is the whole argument about element 1 in one line.

---

## 3. Per-screen notes

Only where there is something worth saying.

### 3.1 `/questions` and `/forms` (the two library lists)

Both are list-shaped, both render through the vendored kit `Table` with `onRowAction` navigation (`components/questions/questions-table.tsx:35-42`, `app/(shell)/forms/forms-table.tsx:29-37`), and both accept the same recorded trade: a kit table cell is a string, so a row cannot hold an anchor, so the row is the control and open-in-new-tab and no-JS operation are given up.

A rail on either would carry the same five items the top nav already carries. Reject.

Element 4 does not apply: every column on both lists is owned by the row's own entity and is read-only. `questionId`, `label`, `type`, `version`, `status`, `created` all belong to the question (`app/(shell)/questions/page.tsx:197-204`); `slug`, `formId`, `locale`, `status`, `draft`, `published` all belong to the form (`app/(shell)/forms/page.tsx:95-102`). There is no foreign owner to make read-only against, so the visual distinction would distinguish nothing.

Element 5 is worth adapting on both, but for a plainer reason than the POC's: neither list has any per-row action at all today. A row grip carrying "Open", "New version" (questions) or "Open builder", "Preview", "Links" (forms) would be a real gain and is the standard place a list gets one. That is a menu, not the POC's insert/move/remove menu: neither list has an author-controlled order to move rows within.

The two screens disagree with each other on creation, and that is worth fixing while a language is being picked: `/questions` sends you to a **route** (`app/(shell)/questions/page.tsx:112-114`), `/forms` puts an inline create **card** on the list (`app/(shell)/forms/page.tsx:72`). Same shape, two answers.

### 3.2 `/questions/[questionId]`

Scope is correct: the h1 is the question id (`app/(shell)/questions/[questionId]/page.tsx:92`) and the selected version is in the URL as `?v=`. No scope bug here.

It is the one non-form screen where a rail would carry something real. Its children are its versions, and they are already rendered as a `<nav>` of links inside a card (`:112-137`). Moving that into a contextual rail would put the version list beside the editor instead of above the preview, which is a genuine improvement for a question with a long history. But note what that costs: the rail would then be carrying an entity's **children** on one screen (versions) and an entity's **siblings** on the form screens (Preview, Versions, Links, Responses, Webhooks). Two meanings for the same furniture is exactly the kind of drift a design language is supposed to stop, so if this is adopted the rail's contract has to be written down first.

Element 3 applies to the version list only ("4 versions . v3 published" is a digest with facts in it). It does **not** apply to the preview card: "Preview" digests to nothing, and a collapsed preview is a preview that is not doing its job.

Width: reject. The editor is a stack of labelled fields (`components/questions/question-editor.tsx:216-284`) and a rendered respondent preview. Both want a readable measure.

### 3.3 `/forms/[formId]` (the builder)

This is the screen the language was designed for, and it is the only one where all seven elements land. Three things worth recording.

First, the shipped builder **does not have the scope bug the POC found**. Its h1 is the form slug and its content is form-level (rules, settings, publish) with the step editor as an h2 inside it (`components/forms/step-editor.tsx:77-79`). The POC created the mismatch by moving to a step-scoped route and then had to split it back out. That is a useful negative result: the mismatch is a consequence of the rail's step-per-route model, not a pre-existing defect.

Second, this is the only screen with an autosave, so element 7 has exactly one customer. The save state today lives inside the validation panel's live region in the right-hand column (`components/forms/validation-panel.tsx:54-61`), which is precisely the placement element 7 objects to. Adopt.

Third, this screen contains the app's **entire responsive vocabulary**: the three `md:` utilities at `components/forms/form-builder.tsx:188`, `:235` and `:240`. Everything else in the app is single-column by default and capped at `max-w-5xl`. So the builder is already fighting the cap while nothing else is, which is the empirical case for element 2 being a builder change rather than a global one.

### 3.4 `/forms/[formId]/preview` and `/forms/[formId]/versions/[version]`

**Element 2 is actively wrong on both.** These screens render what a respondent sees, through the shared `@qcms/ui` renderer inside a scoped preview surface (`components/forms/version-view.tsx:44-54`). A respondent sees the portal's measure. Widening the admin container around the preview does nothing useful and creates a real hazard: an author judging line length and wrapping under a 1600px admin container is judging something no respondent will ever see. If anything these two screens want a **narrower** container than the app default, not a wider one.

The version-detail screen carries a live scope bug, covered in §7.

### 3.5 `/forms/[formId]/versions` (history)

The one screen where the shipped code already made the element-2 argument and won: the version table is five monospace stamp columns and it is wrapped in its own scroll box precisely so the page body does not scroll sideways (`components/forms/version-history.tsx:67-93`, with the reasoning in the comment). That box exists because the page is capped at `max-w-5xl`. Give the screen width and the box stops being load-bearing.

It also holds the app's only correct use of a non-interactive kit table: `qcms-table--static` suppresses the hover affordance because these rows have no row action (`app/globals.css:604-609`). That distinction is good and should survive whatever table consolidation happens.

Element 3 adapts to the diff only: the compare control and its output are the collapsible half, and "v2 to v3 . 4 added, 1 removed" is a digest with facts in it.

### 3.6 `/forms/[formId]/links`

Element 3 must be **rejected on one specific region** and it is worth saying why in the language's own terms. `MintedPanel` (`components/forms/secure-links.tsx:344-414`) is the one moment the secure-link URLs exist; the API never stores a token and nothing can produce them again. A digest of a one-time secret is either the secret (leaked into a summary that survives collapse) or it is useless. The rule element 3 states, "collapsing hides detail but never hides a fact", cannot be satisfied here at all, and the honest conclusion is that one-time reveals are never collapsible. The same applies to `SecretPanel` on the webhooks screen (`components/ops/webhook-config.tsx:329-384`).

The lifecycle table below it is fine and is not a mixed-ownership case: every column belongs to the link.

### 3.7 `/forms/[formId]/responses/[sessionId]`

Detail-shaped, three stacked sections (Summary, Answers, Ledger) plus the erasure door. The ledger is the one genuinely unbounded region on the screen and is the best element-3 candidate outside the builder: "Ledger . 14 entries, 2 retractions" is a digest that states facts. Two constraints, both hard.

The digest must not become the only place the retraction count appears, because a collapsed `<details>` removes its content from the accessibility tree entirely. The count in the summary plus the entries inside is fine. A count that exists **only** in the summary is not.

And the erasure door must not move inside a collapsible. It is the type-to-confirm irreversible action (`components/ops/response-detail.tsx:489-555`); putting it behind a disclosure adds a click to the thing that most needs to be visible before it is reached, and hides the three consequence sentences that are the whole point of the dialog's preamble.

Scope bug: see §7.

### 3.8 `/forms/[formId]/webhooks` and `/webhooks`

Both are the strongest element-2 cases in the app. The per-form screen stacks a six-column config table (`components/ops/webhook-config.tsx:164-249`) above a seven-column delivery dashboard (`components/ops/delivery-dashboard.tsx:57-91`), each holding a full URL and each with `white-space: nowrap` on every cell (`app/globals.css:1286-1295`). The global screen holds a six-column dead-letter table carrying both a URL and a `lastError` string (`components/ops/dead-letters.tsx:155-207`). All three scroll inside their own boxes today. These screens earn width outright.

The delivery dashboard already ships element 3's mechanism in its best form: a per-row disclosure with `aria-expanded`/`aria-controls` and the panel as a second `<tr>` in the same row group (`components/ops/delivery-dashboard.tsx:160-176`). Adding a digest to the trigger ("503, 4 failed attempts, 1.2s") is a small, clearly correct extension. A **page-level** collapsible on either screen is the opposite: an operator arriving here came to see the queue, and collapsing the queue by default costs a click on every visit to answer the question the screen exists to answer.

Element 4 is rejected on the webhook config table, and this is the clearest "does not transfer" case in the audit. See §5.1.

### 3.9 `/responses` and `/webhooks` (the deployment-level index halves)

`/responses` is not a browser, it is a way in: pick a form, or open the erasure log (`app/(shell)/responses/page.tsx:30-58`), and the doc comment says outright that no cross-form response list exists because the API has no route for one. A contextual rail here would carry a list of forms, which is the entire body of the page. Reject: the rail and the page would be the same thing twice.

The same is true of the "Forms" section at the bottom of `/webhooks` (`app/(shell)/webhooks/page.tsx:46-71`).

### 3.10 `/settings`

Prose-and-form shaped, three cards, two of which are password forms already capped at `max-w-sm` (`app/(shell)/settings/page.tsx:77`, `:140`). It is the clearest **reject** on width in the app: the forms are already narrower than the container and widening the container changes nothing except how far the h2s sit from the fields.

Reject on element 3 too. The whole screen is three short cards; collapsing a change-password form behind a summary adds a click to the only reason anyone is here.

---

## 4. Where the shipped screens already contradict each other

These are live today, cost nothing to decide now, and get more expensive with every screen added.

### 4.1 Three table treatments

| Treatment | Where | Rows activate | Works without JS | Cells can hold controls |
|---|---|---|---|---|
| Kit `Table` + `onRowAction` | `components/questions/questions-table.tsx:35-42`, `app/(shell)/forms/forms-table.tsx:29-37` | yes (whole row) | no | no (strings only) |
| Kit `Table` static | `components/forms/version-history.tsx:72-93` | no | yes (read-only) | no |
| Hand-authored `qcms-ops-table` / `qcms-links-table` | `components/ops/response-browser.tsx:203`, `app/(shell)/responses/erasures/page.tsx:54`, `components/ops/webhook-config.tsx:164`, `components/ops/dead-letters.tsx:155`, `components/ops/delivery-dashboard.tsx:57`, `components/forms/secure-links.tsx:435` | no (anchor in the row header) | yes for the links | yes |

Six of the nine tables are hand-authored. The two kit tables that navigate are the two that cannot be opened in a new tab. The two class names `qcms-links-table` and `qcms-ops-table` are already selector-listed together in `app/globals.css:1271-1272` with a comment explaining they are the same thing, which is the code telling us it wants to be one class.

There is also a **frozen design card for this** (`plan/admin-theme/ds-table.html`, `@dsCard group="Components" name="Data table"`) that no shipped table follows: it specifies 44px rows, sortable headers, selection, pagination and a specific empty state. None of the nine tables sorts, selects or paginates.

### 4.2 Two empty-state treatments

- Bordered `Card` with an `h2` and explanatory prose: `app/(shell)/questions/page.tsx:178-191`, `app/(shell)/forms/page.tsx:78-89`.
- A bare muted paragraph: `components/ops/response-browser.tsx:198-201`, `components/ops/dead-letters.tsx:128-131`, `components/ops/delivery-dashboard.tsx:52-55`, `components/ops/webhook-config.tsx:159-162`, `components/forms/secure-links.tsx:426-432`, `app/(shell)/responses/erasures/page.tsx:45-48`, `components/forms/version-history.tsx:57-63`.

Seven bare paragraphs against two cards. And the frozen card prescribes a **third** shape: a dashed-border centred panel with a heading, a sentence and a primary call to action (`plan/admin-theme/ds-table.html:270-276`). Three answers to one question.

The filtered-versus-unfiltered distinction is also handled twice, differently: `app/(shell)/questions/page.tsx:183-187` swaps the heading and drops the body, `components/ops/response-browser.tsx:200` swaps the whole sentence.

### 4.3 Two disclosure idioms

Native `<details>` in the builder (`components/forms/form-settings-panel.tsx:60`, `components/forms/rule-test-bench.tsx:69`) against a hand-built `aria-expanded` button in the delivery dashboard (`components/ops/delivery-dashboard.tsx:160-171`) and in the option grid's grip (`components/questions/option-grid-editor.tsx:459`). Both are defensible in place. What is not defensible is that neither builder `<details>` puts a heading in its `<summary>`, so the Settings and Test bench panels have **no entry in the heading outline at all**, while every other section on the same page has an `h2`.

### 4.4 The form header exists to prevent drift, and the builder opts out of it

`components/forms/form-page-header.tsx` says in its own doc comment that keeping the chrome in one place "is what stops the builder, preview, history, links, responses and webhooks screens drifting into six slightly different headings for the same form". The builder does not use it: `app/(shell)/forms/[formId]/page.tsx:93-113` builds its own breadcrumb and identity line inline, and shows two facts the shared header does not (locale at `:107-108`, draft source at `:110-112`). The docstring is now false about the one screen it names first.

### 4.5 Two confirm-dialog roles for comparable consequences

Rotate and deactivate are `role="alertdialog"` (`components/ops/webhook-config.tsx:454-479`); retarget, which moves queued deliveries including redelivered ones to a new URL, is a plain dialog (`:411-420`). Publish, close, reopen, step removal, revoke, unflag, erase and all three question lifecycle actions are `alertdialog`. Retarget is the odd one out.

### 4.6 Two save models, unnamed

The builder autosaves on a 600ms debounce with an advisory issue list (`components/forms/form-builder.tsx:140-166`). The question editor is a plain `<form>` with an explicit Save button and no autosave (`components/questions/question-editor.tsx:296-302`). Both are correct for their content, and nothing on either screen tells the author which one they are in. If element 7 is adopted, the ambient chrome is the natural place to say so, and saying nothing on the manual screens is not an option: an author who has learned that the builder saves itself will assume the question editor does too.

---

## 5. Where the language does not transfer

### 5.1 The ownership grid is wrong for the webhook config table

On paper it fits: `url` and `active` are owned by the webhook and editable, `secret` and `createdAt` are not. Element 4 would make the URL cell look editable.

It is wrong, and the reason is in the shipped code. Retargeting is not a field edit, it is an operation with a consequence that has to be stated before it happens: queued deliveries, including redelivered ones, move to the new URL (`components/ops/webhook-config.tsx:269-284`). An inline-editable cell is a promise that typing and blurring is the whole interaction. Either the cell would have to raise a confirmation on blur, which is a worse dialog than a deliberate one because the operator did not ask for it, or the consequence sentence disappears. The same argument applies to the `active` column: deactivate is confirmed, reactivate is not (`:219-243`), and a checkbox in a cell erases that asymmetry.

**The generalisable rule:** the ownership grid works where a cell edit is a pure data change (a position, a pinned version, an option label). It does not work where the edit is an operation with a consequence, and "is this cell editable" is the wrong question to ask about those.

### 5.2 Collapsibles with digests are wrong for one-time reveals

Covered in §3.6. Stated as a rule: a section whose content cannot be regenerated must never be collapsible, because its digest cannot both preserve the fact and withhold the value.

### 5.3 Width is wrong for the two preview surfaces

Covered in §3.4. Stated as a rule: a screen whose job is to show what a respondent sees inherits the respondent's measure, not the admin's.

### 5.4 The rail is wrong where the rail would be the page

`/responses` and the Forms section of `/webhooks` are navigational indexes whose body is a list of forms. A rail carrying a list of forms beside a page whose only content is a list of forms is the failure mode the brief names: a rail with nothing to put in it is worse than no rail, and a rail with the page's own content in it is worse still, because now there are two of them and they can disagree.

### 5.5 The POC's route split would break the validation anchors

This is the most concrete disagreement I have with the POC as drawn. The rules POC's rail (`plan/admin-shell-poc/rules-screen-poc.html:485-495`) makes Rules, Validation, Settings and Test bench four sibling **routes** beside Builder.

The builder's validation entries are not a list, they are **links that move focus to the offending control**, and that is the entire reason the API's issues carry a structured domain path rather than a positional index (`components/forms/validation-panel.tsx:101-136`, resolved against ids owned by `components/forms/steps-rail.tsx:273` and `components/forms/step-editor.tsx:166`). Move Validation to its own route and every one of those anchors resolves to nothing. The same list is reused verbatim for a refused publish (`components/forms/form-actions.tsx:322-354`), so the regression hits the publish flow too.

Validation is not a destination. It is a companion to editing and it has to be on the page whose controls it points at. Settings and Test bench can move (the test bench needs the draft, but the draft is server-stored and the bench already round-trips through the API at `components/forms/rule-test-bench.tsx`). Rules can move if rule-scoped issues get a two-hop path, which is a real degradation to accept knowingly rather than discover.

### 5.6 The POC's overlapping digests

`Rules . 3 rules . 1 issue` (`plan/admin-shell-poc/admin-shell-poc.html:729-736`) and `Validation . saved 14:02, 2 issues` (`:935-937`) sit on the same screen, both collapsed by default. Is that three issues or two, one of which is also a rule issue? With both shut there is no way to tell. In the shipped app there is exactly one issue count and it is authoritative (`components/forms/validation-panel.tsx:59`, `:77-82`). A digest is only honest if it is the only count of its kind on the screen, or if the relationship between the counts is stated. Two independent counts of overlapping sets is worse than one count and a click.

---

## 6. The width question, screen by screen

The app caps every authenticated screen at `max-w-5xl` (64rem, about 1024px) in `app/(shell)/layout.tsx:78`, minus `p-6`, so roughly 976px of content. The POC caps at 1600px (`plan/admin-shell-poc/admin-shell-poc.html:327`).

**Genuinely earn width (5):**

- `/forms/[formId]` (builder). Already carrying the app's only three responsive utilities and already fighting the cap.
- `/forms/[formId]/webhooks`. Two wide tables stacked, one of them seven columns with a URL and nowrap cells.
- `/webhooks`. Six columns including a URL and a free-text `lastError`.
- `/forms/[formId]/versions`. Five monospace stamp columns, currently only fitting because of a scroll box added for that reason.
- `/forms/[formId]/links`. Seven columns, four of them timestamps.

**Borderline, take width if it is free (3):** `/forms/[formId]/responses` (five columns), `/responses/erasures` (five columns, two of them ids), `/forms/[formId]/responses/[sessionId]` (the `qcms-ops-summary` definition list already goes two-column above 40rem at `app/globals.css:1370-1374`, and would benefit from a wider label track, but the answers themselves are prose).

**Keep a readable measure (8):** `/questions`, `/questions/new`, `/questions/[questionId]`, `/forms`, `/responses`, `/settings`, and emphatically `/forms/[formId]/preview` and `/forms/[formId]/versions/[version]`, where more width is a correctness problem and not just a taste one (§3.4).

**The practical shape of this:** a per-screen cap set by the route, not a global change. Five screens go wide, two go **narrower** than today, nine stay. A single global raise to 1600px would be wrong for eleven of the sixteen.

---

## 7. Defects found

These are bugs or real defects, not design questions. Reported separately as asked.

### D1. Two routes are headed with the wrong entity (scope mismatch, the exact defect element 6 names)

`components/forms/form-page-header.tsx:35-37` renders `t("forms.builder.heading", { slug })`, and that catalog entry is `"{slug}"` (`lib/i18n/en.ts:432`). So:

- `/forms/{id}/versions/{v}` renders `<h1>` = the **form slug**, a breadcrumb ending in "History" (`lib/i18n/en.ts:671`), and nothing anywhere in the page chrome naming version `{v}`. The version number appears only inside `VersionView`'s own body (`app/(shell)/forms/[formId]/versions/[version]/page.tsx:49-58`).
- `/forms/{id}/responses/{sessionId}` renders `<h1>` = the **form slug** and a breadcrumb ending in "Responses" (`app/(shell)/forms/[formId]/responses/[sessionId]/page.tsx:87-92`). The session id is an `<h2>` inside the component (`components/ops/response-detail.tsx:195-202`).

In both cases the document title region describes the parent while the content is a single child. Two browser tabs open on two different responses of the same form are indistinguishable. This is the same class of defect the form editor hit, in two places the POC did not look at.

### D2. Heading level skips h1 to h3 on the erased-response route

`app/(shell)/forms/[formId]/responses/[sessionId]/page.tsx:63-80` is the branch taken when a response has been erased and only a tombstone remains. It renders `FormPageHeader` (an `h1`), a back link, then `TombstoneCard`, whose first heading is an `h3` (`components/ops/tombstone-card.tsx:47-51`). There is no `h2` between them.

The in-place transition is fine (h1, then `ResponseDetail`'s h2 at `components/ops/response-detail.tsx:195`, then the card's h3). Only the **route** render skips, which is the render an operator gets from a link in a ticket.

This is invisible to the gate: `apps/admin/e2e/a11y-axe.pw.ts:137` restricts axe to `["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]`, and `heading-order` is a best-practice rule carrying none of those tags. The tombstone state is also not among the routes the sweep visits (`:667-714`).

> **Stale as of 2026-08-20, in the premise rather than the finding** (this document is **maintained**, not a frozen snapshot - see the note at §8 item 2). The paragraph above says "the in-place transition is fine" because `ResponseDetail` supplies an `h2`. PR #539 (#510) **deleted that `h2`** as a restatement of the route's own subject, so the premise no longer holds and the in-place path would have started skipping too. PR #542 (#511) repairs both by promoting the tombstone heading and by adding `heading-order` to the gate. The finding was right; the reason it gave for the in-place path being safe has expired.

### D3. `components/area-placeholder.tsx` is dead code

Its own doc comment says "These are the only files 032-035 are expected to delete outright" (`:17`). Tasks 032 through 035 are all `done` (`docs/features/README.md:70-73`) and nothing imports it: the only occurrence of the identifier in the app is its own declaration at `components/area-placeholder.tsx:19`.

It also carries the app's only `text-2xl font-bold` h1 (`:28`), against `text-xl font-semibold` on all nine live headings, so it is a stale style precedent as well as dead weight.

### D4. Two screens render an empty `<ul>` when their forms read fails

`app/(shell)/responses/page.tsx:41-58` and `app/(shell)/webhooks/page.tsx:55-70` both use the shape:

```
{forms.ok && forms.data.length === 0 ? <p>…no forms…</p> : <ul>{(forms.ok ? forms.data : []).map(…)}</ul>}
```

When `forms.ok` is false the ternary takes the **else** branch, so an empty `<ul>` is rendered beneath the error alert. A list element with no items is announced as an empty list by a screen reader and is meaningless to everyone else. The failure branch should render nothing, or the "no forms" sentence.

### D5. An unrecorded wireframe deviation on the response browser - closed by building the column

`docs/wireframes/admin-responses-ops.md` (normative Regions) specifies the browser table as "sessionId, formVersion, submittedAt, accessMode, flagged `tag`, **answer preview**". The shipped table had five columns and no answer preview.

This entry originally offered two ways out and leaned toward the wrong one: it suggested the omission "may well be right" on privacy grounds and asked only that the deviation be **recorded**, in the form the question-library wireframe uses for its dropped "Updated" column. That question has since been asked and answered the other way, in issue 515: the column is built, not deviated from. The wireframe was right, and a preview is only a privacy problem if it is unbounded, which is a property of the implementation rather than of the column.

**Resolved by issue 515.** The column ships bounded by construction: two answered questions per row, each value clipped to a character budget on the string that becomes the text node, no tooltip holding the untruncated value, and nothing on the path logging one (SEC-13). It carries a question id rather than a resolved label, because the list payload has no labels and one page mixes form versions. It is also the column that drops at compact width, which is this table's answer to `plan/admin-design-contracts.md` §2's compact-width clause.

### D6. Minor: `aria-controls` points at an element that does not exist while collapsed

`components/ops/delivery-dashboard.tsx:163-165` sets `aria-controls={panelId}` unconditionally, but the panel is only in the DOM when `isOpen` (`:173-176`). Axe reports this as incomplete rather than a violation when `aria-expanded="false"`, which is why the gate is green, but the attribute is still a dangling reference for two thirds of the row's life. Either render the panel always and hide it, or set `aria-controls` only when open.

### D7. Minor: an unvalidated filter value reports a filtered-empty state that was never filtered

`app/(shell)/forms/[formId]/responses/page.tsx:79` computes `hasFilters` from any non-empty value, while `:48-50` only forwards `flagged` to the API when it is exactly `"true"` or `"false"`. So `?flagged=maybe` renders "no responses match your filters" (`components/ops/response-browser.tsx:200`) when no filter was applied. The same page also concatenates `from`/`to` into an ISO string without validating them (`:46-47`), so a malformed date reaches the API as `xyzT00:00:00.000Z`.

---

## 8. Recommended sequence

Ordered by value against effort. What I would do first, and what I would not do at all.

**Do first, before any of the seven elements.** These are cheap, they are correctness rather than taste, and every one of them gets more expensive once a new language is being applied on top.

1. **Fix D1 (scope mismatch on the two detail routes).** One catalog string and one prop. It is the same defect the form editor spent real time on, it is live in two places, and fixing it now means the scope rule is demonstrated in the codebase before it is written into a language.
2. **Fix D2, D3, D4.** A heading level, a file deletion, and one ternary in two files. While in D2, add `heading-order` to the axe gate's rule set and add the tombstone route to the sweep, or the next one will be invisible too.

   > **Two corrections, 2026-08-20.** This item originally also asked for the **version-detail** route to be added to the sweep. It is already there (`apps/admin/e2e/a11y-axe.pw.ts:604`) and was when this was written; the claim was wrong, not merely overtaken. And enabling `heading-order` turned out to surface two **pre-existing** violations outside the fix's own diff, now filed as #540 and #541 and parked in a `KNOWN_HEADING_ORDER_GAPS` register - a ratchet that still fails on a new node, an unregistered state, or any other rule. Enabling a dormant rule on a shipped app is rarely the one-line change an audit item makes it sound like; budget for the debt it exposes.
   >
   > **This document is maintained, not frozen** (ruled 2026-08-20). It is a working audit that the tier is executing against, so a claim it makes that stops being true gets corrected here rather than preserved with a dated note appended. That is the opposite of the convention for `docs/security-review-2026-08-14.md`, whose table column is literally headed "State at close of review" and which stays frozen. The difference is what the document is for: a review snapshot records what was true on a date; an audit drives work and has to stay accurate to be usable.
3. **Pick one empty state and one table treatment.** The frozen `plan/admin-theme/ds-table.html` card already exists and is followed by nothing; either the card changes or the nine tables do, but three answers to one question is not a position. This is the single change that most affects how the app reads, and it touches no behaviour.
4. ~~**Record D5** as an accepted deviation in `docs/wireframes/admin-responses-ops.md`.~~ **Superseded, 2026-08-20:** issue 515 built the column instead, so there is no deviation left to record and the wireframe and the app now agree. See D5 above.

**Then, the elements that are already house patterns.**

5. **Element 4 plus element 5 on the step editor's pin list.** This is the highest-value design change in the audit. The pin list is the app's one genuine mixed-ownership table: position and pinned version are owned by the **form**, while `questionId`, type and label are owned by the **library**, and the current rendering is a flex row of five separate buttons and a menu (`components/forms/step-editor.tsx:161-234`) that makes none of that visible. The pattern to apply already ships (`components/questions/option-grid-editor.tsx`), so this is an application of an existing card, not a new language. Two constraints carry over from it: the grip menu must keep insert-above and insert-below (`:483-506`), because that is what lets the 14px hairline insert (`app/globals.css:916-924`, and `plan/admin-shell-poc/admin-shell-poc.html:423` in the POC) satisfy WCAG 2.2 SC 2.5.8 under the equivalent-control exception; and if drag reorder is ever added, SC 2.5.7 requires the single-pointer alternative, which the POC's editable position field happens to provide more directly than the option grid does.
6. **Element 7 on the builder**, and a matching explicit statement of the manual save model on the question editor. One screen each. Small, and it closes §4.6.
7. **Element 3 on the builder's existing two `<details>` panels**, adding the digest and, separately, a heading in each `<summary>` so they stop being invisible in the outline (§4.3). Then the delivery dashboard's row trigger. Nowhere else yet.

**Then, and only with a written contract first.**

8. **Elements 1 and 2 on the form subtree only.** Eight screens, one rail, one raised cap on the five screens that earn it and a **lowered** one on the two preview surfaces. Before this starts, the rail's contract has to be written down: what it carries, and specifically whether it carries children (steps, versions) or siblings (sections) or both, because §3.2 shows the two meanings colliding on the very next screen anyone will want to apply it to.
9. **Element 6 as a written rule** in the wireframe format spec, since the Regions inventories are the normative artifact and this is a rule about them: a screen's h1 names the entity its content is scoped to. That is a one-paragraph amendment that makes D1 impossible to reintroduce.

**What I would not do at all.**

- **Do not split Validation onto its own route.** It breaks the anchored issue links and the publish rejection list with them (§5.5). If the rail is adopted, Validation stays on the builder.
- **Do not put a rail on the four deployment-level screens** (`/responses`, `/responses/erasures`, `/webhooks`, `/settings`) or the two library lists. Six of the sixteen screens have nothing to put in one, and two more would only get the top nav back.
- **Do not raise the width cap globally.** It is wrong for eleven of the sixteen screens and actively harmful on two.
- **Do not apply the ownership grid to the webhook config table** (§5.1).
- **Do not make any one-time reveal collapsible** (§5.2).
- **Do not carry the POC's overlapping Rules and Validation digests across** (§5.6). One authoritative issue count, or state the relationship between the two.
