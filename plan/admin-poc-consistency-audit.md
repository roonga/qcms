# Admin POC consistency audit: is the proposed design one system?

**Status:** working analysis, PM/PO seat, 2026-08-19. **Subject:** the eleven
proposals under `plan/admin-shell-poc/`, audited against each other and against
the branch's own normative documents (`plan/admin-ux-audit.md`,
`plan/admin-mobile-stance.md`, the frozen `plan/admin-theme/ds-table.html` card,
and the token sheets). Nothing was run; every claim is read from the files and
cited by file:line. Four independent read-throughs (shell chrome, layout system,
visual vocabulary, component patterns) plus mechanical hashing of the shared
blocks.

## 1. Verdict

**The foundation layer is genuinely one system. The design language on top of it
is not.** The token set, focus rule, shell chrome, rail mechanism, and the
safety rules (one-time reveals, destructive doors) are consistent to the byte
across all eleven files. Above that layer the corpus drifts file by file, and in
several places it reproduces the exact defect class the redesign exists to
eliminate (three table treatments, four empty-state shapes, seven badge
families) or directly violates the audit's and the mobile stance's own rules.

The POCs are internally coherent per screen but are not yet one design. That is
tolerable for proposals; it becomes a defect the moment Wave 3 of
`plan/admin-redesign-implementation-plan.md` implements them screen by screen,
because each implementer would faithfully copy a different answer to the same
question. The fix is a short set of written contracts (section 4) plus a
regeneration pass over the flagship files that currently teach the wrong model
(section 5).

## 2. What is consistent (checked and passed)

- **Tokens: byte-identical.** The `:root` / `.dark` / `prefers-color-scheme` /
  `.hc` blocks match line for line in all eleven files (only explanatory
  comments differ) and match `plan/admin-theme/tokens.css` exactly.
- **Zero hardcoded colour literals** outside the token blocks in any file; the
  only raw functions are `hsl(var(--shadow-color) / N)` shadows, which is the
  intended usage. The tokens-only rule is met.
- **One focus rule everywhere**, identical text: `:focus-visible { outline: 2px
  solid var(--color-focus-ring); outline-offset: 2px; }` in all eleven.
- **Body type is 15px `var(--font-admin)` in all eleven**; one card recipe (1px
  `--color-border`, `--radius-card`, `--color-surface`, `--admin-section-pad`);
  a coherent 1 / 1.5 / 2 / 3px border-width system used the same way everywhere.
- **The shell chrome is one design**: same topbar markup and CSS, same five nav
  items in the same order, same `aria-current="page"` treatment, same avatar
  button, in every shelled file; `auth-poc.html` drops the shell deliberately
  and argues why at `:4-25`.
- **The mode switcher is uniform**: the same three-button Light / Dark / High
  contrast group with an identical `setMode()` in all eleven (one file adds a
  "Mode" legend span, section 3.5).
- **The rail mechanism and the viewport-fill fix are byte-identical in all
  seven rail-bearing files**: native `<details class="rail-shell">`, 240px grid
  column at 1024px, `body { display:flex; flex-direction:column;
  min-height:100vh }` + `.shell-body { flex:1 1 auto; min-height:0 }`.
- **Every table in the corpus scrolls inside its own `overflow-x: auto`
  container** (all 13 tables); ten of eleven files carry the page-level
  horizontal-scroll backstop on `body`.
- **The safety rules hold wherever they apply**: no one-time secret reveal is
  collapsible in any of the three files that draw one; no destructive door sits
  inside a collapsible; danger tokens are applied consistently; every grip menu
  carries insert-above/below with the same WCAG 2.5.7 rationale comment.

## 3. Drift, ranked by cost

### 3.1 The proposal reproduces the shipped app's own named defect

`plan/admin-ux-audit.md` §4.1-4.2 found three table treatments and two
empty-state shapes shipping side by side and called picking one "the single
highest-value move in this whole audit." The proposal set answers with:

- **Three table implementations.** `.qgrid` (`admin-shell-poc.html:423-430`,
  `responses-poc.html:386-393`, `preview-versions-poc.html:393-400`: 44px rows,
  no zebra, no tabular figures), `.lib-table` (`library-lists-poc.html:332-341`:
  44px rows, zebra, tabular figures), and `.ops-table` - which itself means two
  different geometries: 44px rows with zebra in `deployment-ops-poc.html:283-291`
  versus no row height and no zebra in `links-webhooks-poc.html:416-424`. Cell
  padding takes five values across the six table screens; `min-width` takes five
  (560 / 640 / 700 / 720 / 860px). The scroll-wrapper class name also splits
  three ways (`.qgrid-scroll` / `.ops-table-scroll` / `.table-scroll`), and
  `.ops-table-scroll` is a bordered card in one file and a bare overflow box in
  the other.
- **Nothing follows the frozen card fully.** Zero files draw
  `plan/admin-theme/ds-table.html`'s sortable headers (`aria-sort` appears
  nowhere), selection column, or loading skeleton, against the card's own
  subtitle "Sort, selection, pagination, empty, skeleton".
- **Four-plus empty-state shapes.** Only `library-lists-poc.html:407-412`
  matches the frozen card (dashed panel, heading + sentence + CTA).
  `deployment-ops-poc.html:301-306` drops the CTA and adds a green "reassuring"
  variant; `responses-poc.html:729,734` uses the bare muted paragraph the audit
  tells the redesign to drop; `rules-screen-poc.html:345-346` uses a thinner
  dashed border with no heading and no CTA.
- **Three pagination idioms.** `<nav class="pager">` with ghost buttons
  (`library-lists-poc.html:705-711`), `<nav class="pagination">` with text
  anchors (`responses-poc.html:720-724`), `<div class="pagination">` with
  different labels (`add-question-poc.html:571-575`) - and the forms table on
  the library screen has no pager at all while the questions table beside it
  does.
- **Seven badge families, one state coloured two ways.** `.tag` is redefined
  with four different metrics across four files; `.tag--active` on the same
  webhook object is info-blue in `links-webhooks-poc.html:430` and
  success-green in `deployment-ops-poc.html:333`; draft/published/deprecated
  exist as both `.tag--*` and `.qcms-tag--*` with different metrics; the same
  "Current" marker appears as `.vstatus--current` and `.version-option__tag`;
  dead-lettered rows read "Dead-lettered" and "Needs attention" inside one file
  (`deployment-ops-poc.html:637`, `:767`).
- **The same content drawn two ways**: the question library is a 44px table in
  `library-lists-poc.html:547-701` and a `<ul role="listbox">` of `.q-row`
  divs in `add-question-poc.html:504-570`.

### 3.2 Violations of this branch's own normative documents

- **Validation is a rail route in `rules-screen-poc.html:487`.** The audit's
  hardest "do not do at all" (§5.5, §8): it breaks the anchored issue links and
  the publish-rejection list with them. This POC teaches the one model the
  audit forbids.
- **The overlapping issue-count digests the audit condemned (§5.6) are still in
  `admin-shell-poc.html`**: "Rules · 3 rules · 1 issue" (`:854-860`) and
  "Validation · 2 issues" (`:936-937`) both collapsed on one screen, plus
  further counts in the rail (`:733`, `:754`) and the grid (`:1063`), with the
  relationship between them stated nowhere.
- **Seven distinct breakpoint numbers against the stance's mandated two.**
  420, 480, 639, 900, 999, 1023, 1024 (per-file inventory in section 3.4), none
  tokenized: no file declares a breakpoint or width custom property, while
  `--admin-section-pad` proves the corpus already has the convention. The same
  option-grid component drops its ID column at 639 in
  `question-editor-poc.html:510-513` and at 480 in
  `settings-newquestion-poc.html:470-473`, whose own comment (`:467-468`)
  claims it makes "the same trade" - the comment and the code disagree.
- **The erasure confirm is a plain `role="dialog"`** in
  `responses-poc.html:926` - the canonical `alertdialog` case
  (`plan/admin-ux-audit.md` §4.5). Only `links-webhooks-poc.html` distinguishes
  destructive (`alertdialog`, `:1035`, `:1093`, `:1108`, `:1123`) from plain
  dialogs; `deployment-ops-poc.html:736-747` draws the identical "Redeliver
  all" action as a non-modal inline `<details>` confirm with a primary (not
  danger) button, where `links-webhooks-poc.html:1122-1135` draws it as a modal
  `alertdialog` with a danger button.
- **`question-editor-poc.html` commits the exact §4.6 save-model confusion the
  audit warns about**: an ambient "Saved 09:41." strip (`:562`, autosave
  wording) on the same screen as an explicit "Save draft" button with its own
  "Draft saved." live region (`:848-851`).
- **`rules-screen-poc.html` says nothing about its save model at all**: a full
  screen of live condition editors (`:549-582`, `:628-711`) with no ambient
  strip, no Save button, and no statement. Its "Remove rule" buttons (`:540`,
  `:620`, `:753`) are also the corpus's only destructive control with no
  confirm and no danger tint.
- **A settings rail exists** (`settings-newquestion-poc.html:559-565`), which
  the audit's row 16 rejects - already tracked as decision C1 in
  `plan/admin-redesign-implementation-plan.md` §2, listed here only for
  completeness.

### 3.3 The rail has four incompatible contracts

The audit (§3.2, §8 item 8) requires one written meaning before the rail
reaches real code. The POC set has four:

| File(s) | Rail carries | Contract |
|---|---|---|
| `admin-shell-poc.html:696-776`; `responses-poc`, `preview-versions-poc`, `links-webhooks-poc` (same shape) | form, steps group, then Preview/Versions/Links/Responses/Webhooks | children + siblings |
| `question-editor-poc.html:576-620` | version list, plus a `.rail-lifecycle` action block (`:589-598`) | children only - and the only rail carrying actions rather than navigation |
| `settings-newquestion-poc.html:559-565` | Account / Change password / 2FA as `<button>` elements switching panels of the same page | sections of one page |
| `rules-screen-poc.html:459-497` | a "Builder" group (not "Steps"), then Rules/Validation/Settings/Test bench, then the sibling screens | children + siblings + a second sibling tier, different group label |

Collapsed-summary behaviour splits five ways against the stance's one rule
("summary names the active step and that step's issue count",
`plan/admin-mobile-stance.md`): only `admin-shell-poc.html:680-686` implements
it; `preview-versions-poc.html:518-521` names the screen but drops the count;
`question-editor-poc.html:569-572` names the version under a fourth class name;
`responses-poc`, `rules-screen-poc` and `settings-newquestion-poc` show only
the form or screen name; and `links-webhooks-poc.html:519-522` ships the
summary markup permanently `hidden`, hard-coded to "Health" - a step - while
the active rail item is Webhooks, a sibling. Three railed files
(`responses-poc`, `rules-screen-poc`, `settings-newquestion-poc`) have no
`max-width: 1023px` rule at all, so their collapsed state diverges from the
four that do. `rules-screen-poc.html:453-455` and
`settings-newquestion-poc.html` also omit the `.rail-summary__label` wrapper
and the truncation rules the other five carry, so a long form name cannot
ellipsize at 390 in exactly those two.

Structural drift inside the same contract: `rules-screen-poc.html:271-276`
draws step rows with neither grips nor menus and reinstates a `padding-left`
that `admin-shell-poc.html:317-319` documents as deliberately removed; only two
of the four children+siblings files style the active step row at all.

### 3.4 Layout numbers: breakpoints and width caps

Per-file inventory (media-query widths and main container caps):

| File | Width queries | Main cap |
|---|---|---|
| `add-question-poc.html` | 900 max | 1600 (`.page-behind`); dialog 900 |
| `admin-shell-poc.html` | 639 max, 1023 max, 1024 min | 1600 |
| `auth-poc.html` | 420 max | 26rem; shell `min-height: 70vh` |
| `deployment-ops-poc.html` | 480 max | none; per-screen 900 / 1180 / 1820 |
| `library-lists-poc.html` | 639 max | 1080 |
| `links-webhooks-poc.html` | 1023 max, 1024 min | 1600 |
| `preview-versions-poc.html` | 639 max, 1023 max, 1024 min | 1600; respondent frame 640 |
| `question-editor-poc.html` | 639 max, 1023 max, 1024 min | 1600; editor column 720 |
| `responses-poc.html` | 900 min, 1024 min | 1600 |
| `rules-screen-poc.html` | 999 max, 1024 min | 1600 |
| `settings-newquestion-poc.html` | 420 max, 480 max, 1024 min | 40rem |

Specific contradictions:

- **The same route is capped two ways**: Webhooks is 1820px in
  `deployment-ops-poc.html:249` and 1600px in `links-webhooks-poc.html:318`;
  Responses is 900px in `deployment-ops-poc.html:247` and 1600px in
  `responses-poc.html:323`. 1820 and 1180 appear nowhere else.
- **Two mechanisms for per-screen width**: `deployment-ops-poc.html` implements
  the audit's per-screen model literally (uncapped `.main` + per-screen inner
  caps); every other multi-screen file uses one shared 1600px `.main` for all
  its screens - including `preview-versions-poc.html:331`, which puts the
  Preview surface and the version-detail surface (the two screens the audit
  says want a narrower container than the app default, §3.4, §6) inside the
  same 1600px container and resolves the tension by capping only the inner
  `.respondent-frame` at 640 (`:446`) - a resolution the audit never blessed.
  `question-editor-poc.html` makes the same move (1600 `.main`, 720
  `.editor-column`) on a screen the audit marks "width: reject".
- **"Panes stack rather than shrink" is expressed at three numbers**: 900 max
  (`add-question-poc.html:300`), 999 max (`rules-screen-poc.html:362`), 900 min
  (`responses-poc.html:420`) - none a named boundary.
- **Compact column-dropping is applied in two files and omitted in four.**
  `admin-shell-poc.html:548-558` and `preview-versions-poc.html:410-414` reset
  the table `min-width` at 639 and drop columns; `responses-poc.html:386`
  (860px, the widest table), `links-webhooks-poc.html:416`,
  `library-lists-poc.html:332` and `deployment-ops-poc.html:283` have no
  narrow-width override, so a 390 viewport gets long in-container scrolls -
  and `preview-versions-poc.html:405-409` documents why the override matters,
  which makes its absence elsewhere a known-hazard omission.
- **The viewport-fill pattern is absent from the four unrailed files with three
  different substitutes**: `add-question-poc.html:281` uses `.stage
  { min-height: 100vh }`, `auth-poc.html:249` uses `min-height: 70vh` (the only
  non-100vh value), `deployment-ops-poc.html` and `library-lists-poc.html` have
  none. `library-lists-poc.html:189,196` alone uses `overflow-x: clip` (with an
  argument at `:178-188` for why `hidden` is wrong) against `hidden` in the
  other ten - one of the two positions is incorrect for all eleven.

### 3.5 Chrome, naming and structural drift

- **Seven h1 class names** for the same slot (`.step-heading`, `.page-heading`,
  `.page-title`, `.ops-heading`, `.rules-h1`, `.qcms-question-id`,
  `.auth-heading`) and **four h1 sizes**: 1.4rem/700 in eight files, 1.5rem
  (`settings-newquestion-poc.html:311`), 1.25rem/700
  (`auth-poc.html:256`), 1.25rem/600 mono (`question-editor-poc.html:325`).
  Four names for the intro paragraph under it. No file uses the shipped
  `--type-*` scale; every heading is a raw rem literal.
- **Two button scales**: `.btn` is 40px / 0.88rem / 16px padding in nine files
  but 40px hardcoded / 0.92rem / 18px in `auth-poc.html:284-286` and
  `settings-newquestion-poc.html:366-368` (which match `ds-table.html:167` -
  so the nine or the two are off-card, not both). `.btn-ghost` is opaque
  surface in three files and transparent in three;
  `question-editor-poc.html:365-368` alone makes bare `.btn` primary by
  default. `.btn-primary:disabled` has two different treatments.
- **Breadcrumbs on 5 of 11 screens, with two different trail roots** (form-root
  in `admin-shell-poc.html:974-975` and `links-webhooks-poc.html:622-623`;
  Forms-root in `responses-poc.html:573-575` and
  `preview-versions-poc.html:801-804`), ancestors rendered as links in four
  files and bare text in one (`links-webhooks-poc.html:622`, `:741`), and
  screens at identical depth with and without a trail
  (`rules-screen-poc.html:515` has none; `links-webhooks-poc.html:626` does).
- **Landmarks**: `settings-newquestion-poc.html` emits two `<main>` elements
  (`:570`, `:681`) where every sibling wraps multiple screens in one; nine
  files declare `id="main-content"` and zero files provide a skip link;
  `add-question-poc.html:452` omits the id.
- **Topbar drift**: the "Appearance settings" icon button is dead chrome (no
  handler) in all ten files that have it and absent from
  `library-lists-poc.html:452-454`; `deployment-ops-poc.html:413-418` uses a
  person-icon account button where the other eight use the CO avatar button;
  `add-question-poc.html:222-223` fixes the topbar height (`height` not
  `min-height`) and adds a margin no sibling has;
  `deployment-ops-poc.html:401` marks Responses current and never updates it
  when its Webhooks screen shows. Active-nav semantics are unstated: three
  form-child screens keep Forms current, which is defensible but nowhere a
  rule.
- **Save-state chrome**: present on five files saying four different things
  ("Saved 14:02." / "Live data..." / "Up to date." / an identity strip reusing
  the `.save-status` class in `preview-versions-poc.html:511`, which also
  alone omits `aria-live`), absent from six.
- **The rail/shell class vocabulary forks in one file**:
  `settings-newquestion-poc.html:551` uses `.settings-shell-body` and
  `#settings-rail-shell` against `.shell-body` / `#rail-shell` in the six
  others, and its rail items are `<button>`s where every other rail uses
  `<a>`.
- **Viewer-aid chrome** (not shipped shell, but it teaches conventions): the
  screen switcher has six class names across the corpus and sits inside
  `<main>` in two files against above-the-shell in the rest;
  `library-lists-poc.html:426` alone labels the mode switcher;
  `add-question-poc.html:2` alone breaks the `... POC` title suffix; the
  `@dsCard group` split (Layout / Screens / Overlays) puts `responses-poc` and
  `deployment-ops-poc` - two responses screens - in different groups.
- **Minor inventory**: eight shadow alpha combinations and no shadow token;
  mono identifier sizes from 0.82rem to 0.88rem plus one relative `0.85em`;
  focus-ring offset overrides at 1 / -2 / 3px in five places; `--admin-stack`
  declared eleven times and used once; the option grid copied between
  `question-editor-poc` and `settings-newquestion-poc` with five small
  divergences (column width, head font, z-index, breakpoint, HC border rule);
  duplicated `.recovery-panel` CSS in `auth-poc` and `settings-newquestion-poc`.

### 3.6 The POC token vocabulary does not intersect the shipped sheet

The POCs and `plan/admin-theme/tokens.css` use `--admin-control-h` (40px),
`--admin-section-pad` (1.25rem), `--admin-stack`, `--admin-table-row-h`,
`--font-admin`; the shipped `packages/ui/src/theme.css` ships
`--space-control-h` (44px), `--space-section-pad` (2.25rem), `--space-stack`,
`--font-portal`, and the `--type-*` family - none of which any POC references.
The two spacing/typography vocabularies are disjoint and their values differ.
Whoever implements Wave 3 must reconcile them, and no document currently says
which wins. (Colour tokens do align; the gap is spacing and type.)

### 3.7 Collapsible digests: the rule is followed in four files and dropped in one

Eight collapsibles in `question-editor-poc.html` carry no digest at all
(`:683-687`, `:709-713`, `:811-815`, `:824-828`, and the four published-state
duplicates), against the same `.stacked-card` component used correctly in
`admin-shell-poc.html:808-814`, `responses-poc.html:844`,
`links-webhooks-poc.html:849`. Two digests are weaker than the audit's own
worked examples: the compare digest omits the added/removed counts the audit
specified (`preview-versions-poc.html:730` vs `plan/admin-ux-audit.md` §3.5),
and the ledger digest omits the retraction count (`responses-poc.html:844` vs
§3.7) even though a retracted entry is drawn at `:859`.

## 4. Contracts to write before Wave 3

Each of these is a question the eleven files currently answer two to seven
different ways. One page total; every item names its owner-decision only where
one is genuinely open.

1. **Two named, tokenized breakpoints** (`--bp-compact` ~640, `--bp-sidebar`
   1024) and a rule for where "panes stack" keys. Executes
   `plan/admin-mobile-stance.md`'s standing recommendation.
2. **One table spec**, reconciled with the frozen `ds-table.html` card: one
   class family, one row height, one padding, zebra or not, tabular figures or
   not, where the row's primary link lives, and what compact width drops.
   Either the card changes or the tables do (this extends issue #514's scope
   to the proposal set).
3. **One empty-state spec** (the frozen card's dashed panel), with the
   filtered-vs-true-empty variation stated once.
4. **One badge family** with a fixed metric and a colour-per-state map, so
   "active" cannot be blue and green at once.
5. **One dialog rule**: which consequences take `role="alertdialog"`, one
   overlay implementation, one button order. The shipped app's own §4.5
   convention (destructive and consequence-bearing confirms are alertdialogs)
   is the obvious candidate.
6. **One save-model statement per screen**: ambient chrome where autosave
   exists, an explicit statement where it does not, never both, never neither.
7. **The rail contract**: what the rail carries (recommendation: children +
   siblings as drawn in the four form-subtree files; version lists count as
   children), whether an action block may live in it, what the collapsed
   summary must name (the stance already answers: active item + issue count),
   and whether a settings rail is the same component or a one-off (decision C1
   territory).
8. **The spacing/typography reconciliation** with
   `packages/ui/src/theme.css`'s `--space-*` / `--type-*` families (section
   3.6): adopt, alias, or explicitly diverge with a stated reason.

## 5. Which files teach the wrong model at regeneration time

The Wave 4 regeneration pass (see `plan/admin-redesign-implementation-plan.md`)
should treat these as must-fix in the flagship files, because implementers will
copy from them:

- `admin-shell-poc.html`: the overlapping Rules/Validation digests (§5.6 of the
  audit, restated in 3.2 above).
- `rules-screen-poc.html`: Validation as a rail route; the silent save model;
  the unconfirmed, untinted "Remove rule".
- `responses-poc.html`: erasure as a plain dialog; the bare-paragraph empty
  states.
- `question-editor-poc.html`: the ambient-save strip beside an explicit Save
  button; the eight digest-less collapsibles.
- `links-webhooks-poc.html`: the dead hidden rail summary naming the wrong
  item; the heightless `.ops-table` variant.
- All eleven: whichever single answer the section-4 contracts pick.
