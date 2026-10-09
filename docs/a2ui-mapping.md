# A2UI mapping - question types → a2-react-aria components (task 011)

**Status: inventory complete · all seven question types map to real registry components.**
The `longText` gap that parked this task is resolved upstream: `@a2ra/core@1.0.0-preview.7`
ships a `TextArea` component (node type `"TextArea"`).

The A2UI spec is `@a2ra/core`'s exported Zod schemas (ADR-22). This document records the
registry inventory the compiler is allowed to target and the question-type → component
mapping. The compiler emits **only** components listed here; anything the registry lacks is
a cross-repo issue, never a local invention.

## Inventory source of truth

| What               | Value                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| Registry listing   | `@a2ra/core` exported `*Schema` set, 2026-07-20                           |
| Schema package     | `@a2ra/core@1.0.0-preview.7` (npm `latest`) - `a2uiSpecVersion` pins this |
| Validation surface | `A2NodeSchema` / `safeParseNode` (recursive) + each component's `*Schema` |

Note: `@a2ra/core` still exports a `VERSION` constant of `"0.1.0-preview.0"`, stale
relative to its own `package.json` (`1.0.0-preview.7`). qcms pins `a2uiSpecVersion` to the
**package version** it validates against, not the exported constant (upstream issue to
relay - unchanged since preview.6).

## Registry inventory (23 components, `1.0.0-preview.7`)

Form controls: `text-field` (TextField) · **`text-area` (TextArea) - new in preview.7** ·
`number-field` (NumberField) · `date-picker` (DatePicker, DateRangePicker) · `checkbox`
(Checkbox, CheckboxGroup) · `radio` (Radio, RadioGroup) · `select` (Select) · `switch`
(Switch) · `form` (Form).

Structure and content: `text` (Text: `as` h1–h4/p/span/label, size/weight/color/align) ·
`layout` (Flex, Grid) · `card` (Card) · `alert` (Alert) · `accordion` · `tabs` · `table` ·
`tag` (Tag, TagGroup).

Interaction/overlay (not used by the compiler): `button` · `dialog` · `menu` · `popover` ·
`tooltip` · `breadcrumb`.

`TextArea` is a first-class multiline control: its props include `rows`, `minLength`,
`maxLength`, `name`, `label`, `description`, `errorMessage`, `isRequired`. `TextField`
remains single-line (`type` is `text | email | password | number | tel | url`; no `rows`).

## Question-type mapping

Component names below are the A2UI node `type` literals from the `@a2ra/core` schemas
(registry item name in parentheses). All schemas are `strict` on props - unknown props are
rejected, so the compiler emits only listed props. All constraint props are **advisory
client-side hints** - server-side domain validation (`validateAnswer`, task 009) is the
authority.

| Question type                | Component                                                                             | Props (from question)                                                                                                                        | Advisory hints (from constraints)                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `shortText`                  | `TextField` (`text-field`)                                                            | `label`, `description` (help), `name` = questionId                                                                                           | `isRequired`, `minLength`, `maxLength`, `pattern`                                                               |
| `longText`                   | `TextArea` (`text-area`)                                                              | `label`, `description` (help), `name` = questionId                                                                                           | `isRequired`, `maxLength`                                                                                       |
| `number`                     | `NumberField` (`number-field`)                                                        | `label`, `description`, `name`                                                                                                               | `isRequired`, `minValue`, `maxValue`, `step: 1` when `integer`                                                  |
| `date`                       | `DatePicker` (`date-picker`)                                                          | `label`, `description`, `name`, `granularity: "day"`                                                                                         | `isRequired`, `minValue`, `maxValue` (canonical `YYYY-MM-DD` strings)                                           |
| `boolean`                    | `RadioGroup` (`radio`) with two `Radio` children, values `"true"` / `"false"`         | `label`, `description`, `name`; child labels are the author's `yesLabel`/`noLabel` if set, else locale-resolved lexicon Yes/No text (ADR-36) | `isRequired`                                                                                                    |
| `singleChoice` (≤ 7 options) | `RadioGroup` (`radio`) with one `Radio` per option, `value` = optionId                | `label`, `description`, `name`; child `label` from option label                                                                              | `isRequired`                                                                                                    |
| `singleChoice` (> 7 options) | `Select` (`select`) with `items` (`value` = optionId)                                 | `label`, `description`, `name`, `items`                                                                                                      | `isRequired`                                                                                                    |
| `multiChoice`                | `CheckboxGroup` (`checkbox`) with one `Checkbox` child per option, `value` = optionId | `label`, `description`, `name`, `orientation: "vertical"`                                                                                    | `isRequired` (min/maxSelected have no upstream prop - server-only, surfaced in help text by authors if desired) |

### Documented choices

- **`longText` → `TextArea`, not a single-line `TextField`.** Now that the registry has a
  real multiline control, `longText` maps to it directly. The compiler does **not** set a
  `rows` value - the domain has no such property and a fixed guess would freeze a UX
  decision into immutable snapshots; the renderer's default height applies. `maxLength` is
  forwarded as an advisory hint (`longText` constraints carry `maxLength` only).
- **`boolean` → yes/no `RadioGroup`, not a single `Checkbox`.** A lone checkbox conflates
  "unanswered" with "false" and turns `required` into consent-must-check semantics. The
  kernel distinguishes unanswered from `false` (the `answered` operator, ADR-16 hidden
  exclusion), so the control must too. Radio values are the strings `"true"`/`"false"`,
  mapped to the canonical boolean `AnswerValue` at the answer boundary. Yes/No child labels
  are **authored content over a lexicon default** (ADR-36, task 048): each label is the
  question's `yesLabel` / `noLabel` `LocalizedText` resolved for the active locale when the
  author supplied one, and otherwise the compiler affirmation lexicon entry keyed by the
  locale's language subtag (`BOOLEAN_AFFIRMATION`), English fallback. The fallback is **per
  label**, so overriding "Yes" leaves "No" on the lexicon. The lexicon remains a compiler
  constant frozen into output via `compilerVersion`, and gains entries alongside each new
  launch locale (R7 - no second locale before Phase 4). An override is presentation payload
  only: the wire values stay `"true"`/`"false"`, so no rule, export or report changes
  meaning, and content carrying no override compiles byte-identically (the golden corpus is
  the proof).
- **`singleChoice` threshold: 7.** Up to 7 options render as a `RadioGroup` (all options
  visible, one tap, best for the common short list); above 7, a `Select` keeps the step
  scannable. The threshold is a compiler constant (`SINGLE_CHOICE_SELECT_THRESHOLD = 7`)
  frozen into compiled output via `compilerVersion`.
- **`multiChoice` min/maxSelected:** `CheckboxGroup` has no min/max-selected props;
  these constraints stay server-side only (they were always authoritative there). No local
  fork of the component to add them (ADR-22).

## Step document structure (accessibility groundwork, 028 contract)

Each step compiles to one A2UI document:

- Root: `Form` → `Flex(direction: "column")`.
- Headings: form title as `Text(as: "h1", size: "2xl", weight: "bold")` on the first
  step only; step title as `Text(as: "h2", size: "xl", weight: "semibold")` on every
  step - the renderer maps these to the page heading outline.
  **The size and weight are part of the mapping, not a renderer default** (issue #186,
  generation `v3`). The vendored `Text` defaults to `size: "md"`, `weight: "normal"`,
  which is the body treatment, so a document that named only `as` produced headings
  typographically identical to the question labels beside them: correct outline,
  invisible hierarchy, and no gate could see it (axe checks that a heading is a
  heading, not that it looks like one). Stating the intent in the stored document is
  what makes it survive a renderer that changes its defaults, and what gives a
  non-QCMS renderer anything to read.
  A host that embeds a compiled document inside a page with its own `<h1>` lowers the
  levels at render time instead (`A2UIStepRenderer`'s `headingLevelOffset`, issue
  #537); the stored bytes are never touched, and the typography above is deliberately
  left alone so an embedded preview still shows what a respondent saw.
- Every control carries `label` and, when the question has help text, `description`
  (upstream renders these with the correct ARIA associations; component-level a11y is
  tested upstream per ADR-22).
- Error slots: every control node leaves `errorMessage` **unset** in compiled output -
  it is the per-question error slot the renderer (028) fills from server validation
  results. The `name` prop (= questionId) is the key the renderer uses to route errors.
- **Author validation messages (`messages`, ADR-32, task 048):** a control node MAY carry
  one extra prop, `messages`, mapping a constraint key (`required`, `minLength`,
  `maxLength`, `pattern`, `min`, `max`, `integer`, `minSelected`, `maxSelected`) to the
  author's wording for that constraint, resolved for the active locale. Keys are emitted in
  `@roonga/qcms-core`'s canonical `VALIDATION_MESSAGE_KEYS` order rather than the authored object's
  own order, so the document is a function of content alone. The prop is **absent** unless
  the author wrote at least one message, which is what keeps pre-048 content byte-identical.
  It is payload the host reads when it fills the error slot above, keyed off the `constraint`
  the API's 422 names; the renderer never evaluates it, and a constraint with no entry falls
  back to the portal's default catalog wording (per constraint, not per question).
  `messages` is a **qcms-side extension** to the otherwise-`strict` vendored props: the
  vendored schemas stay byte-identical (ADR-22), and `@roonga/qcms-ui`'s registry wraps each
  question control's schema in `withAuthorMessages` so a node carrying the prop validates.

## Honeypot decoy (task 026, abuse controls)

Every step document ends with one **`Honeypot`** node - a visually-hidden decoy
field. A real respondent never sees, focuses, or fills it; an automated
form-filler that blindly populates inputs trips it, and the submit slice (020)
silently flags that session (`HONEYPOT`) with the same success-shaped response
(no tell). It is appended **last** in the `Flex(column)`, after all controls.

`Honeypot` is a **qcms-specific node type**, not an `@a2ra/core` registry
component - no real control is rendered off-screen with `aria-hidden`, and the
`TextField` schema is `strict` and carries none of the hiding props. A dedicated
type makes the decoy unmistakable (it can never be confused with a real field)
and self-describing. It is a **renderer-compat contract**: the renderer (028)
must recognize the type and emit the hidden wrapper below.

| Node       | Props                                                                                           | Renderer contract (028)                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Honeypot` | `name` (the submit key, `"website"`), `autoComplete: "off"`, `ariaHidden: true`, `tabIndex: -1` | An `<input>` with that `name`/`autocomplete`/`tabindex`, wrapped in an `aria-hidden` off-screen container; **no** `<label>` and no accessible name. |

Reference rendering (the a11y contract asserted at the node/DOM level here; the
live axe pass is 028/030):

```html
<div
  aria-hidden="true"
  style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;"
>
  <input name="website" autocomplete="off" tabindex="-1" />
</div>
```

## Repeating group (task 073, ADR-42, ADR-43)

A repeating group in a step's item list compiles to one **`RepeatGroup` template**
node, in the group's document position, carrying its member controls **once** with the
bare `questionId` as each control's `name` - identical to what the same question
compiles to outside a group, because a question does not know that it is repeated.

`RepeatGroup` is a **qcms-specific node type**, not an `@a2ra/core` registry
component, on the same footing and for the same kind of reason as `Honeypot` above:
nothing upstream describes a container whose children are cloned per instance, and the
vendored component schemas are `strict` (ADR-22). It is a **renderer-compat contract**.

**The compiler cannot expand the group and does not try.** `compileFormWith` is pure
and answer-blind (`StepResolverContext` carries the snapshot, the locale and the
resolvers and nothing else, ADR-14 as amended 2026-09-30) and an instance count is
answer-dependent. The renderer clones the template once per **live instance**, in
roster order, and rewrites each clone's `name` from `q_passport` to
`ins_7k2/q_passport`; the roster reaches it from the API's step projection. The stored
bytes are never touched, so ADR-18 holds exactly and the expansion is a render-time
transform on the precedent `withNativeSubmit` and `documentForVisible` set.

**The honeypot is never inside the template.** The decoy is appended to the step's
`Flex` after the group node, so cloning cannot duplicate it and a ten-instance step
carries exactly one (ADR-12; asserted in the compiler corpus, in the renderer and in
the portal's browser suite).

| Node          | Props                                                                                                                              | Renderer contract                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RepeatGroup` | `groupId`, `label`, `instanceLabel` (with `{n}` intact), `presentation`, `countSource`, `min`, `max?`, `addLabel?`, `removeLabel?` | Expand into one instance group per live instance, qualify each cloned control's `name`, and render Add and Remove controls for `countSource: "open"` alone. |

- `instanceLabel` keeps its `{n}` placeholder, because the ordinal it names is the
  instance's **live** one-based position and is recomputed after a removal, which is
  render-time state and not content.
- `presentation` is `stacked`, `perInstanceStep` or `table`. Task 073 renders
  `stacked` and task 076 renders `perInstanceStep`; `table` is task 077.
  **`perInstanceStep` changes no prop and no stored byte**: the host tells the expansion
  which view it is drawing (`RepeatExpansion.view`, a `{groupId, instanceId}` pair the
  API's step projection supplies), and the expansion then clones the template for that
  one instance while naming it from its place in the full roster and putting the Add
  control on the last view alone. The presentation is a render-time narrowing of the same
  node, which is why the compiled document for a group is identical whichever of the two
  presentations its author chose.
- `countSource` is `fixed`, `fromAnswer` or `open`. Add and Remove exist for `open`
  alone: a `fixed` group's size is its author's and a `fromAnswer` group's is the
  count answer's.
- `min` and `max` are the declared bounds. A `fixed` count is its own bound, so both
  are its `count`. `max` is absent only when a bounded source omitted it, which
  publish refuses (`REPEAT_MAX_MISSING`, SEC-16), so it cannot be absent on a
  published snapshot.
- `addLabel` and `removeLabel` are emitted for `countSource: "open"` only, from a
  **compiler lexicon** frozen by `compilerVersion` (`REPEAT_ACTION_LEXICON`), exactly
  as the boolean Yes/No lexicon is and for the same reason (ADR-36's Note): nothing
  authored supplies action wording, and the stored document is what a renderer that is
  not ours reads. `addLabel` is resolved ("Add Vehicle", built from the instance-label
  template with its `{n}` removed, because the group's own `label` names the whole
  collection). `removeLabel` keeps a `{label}` placeholder the renderer fills with the
  resolved instance label, giving "Remove Vehicle 3": APG's naming practice puts the
  distinguishing words first, so it is never "Vehicle 3 remove".

### The render-time nodes a presentation expands to (tasks 073 and 077)

The compiler emits one node type, `RepeatGroup`. The renderer expands it, and **which
nodes it expands to is the presentation's choice**. None of these reaches a stored
document, so none of them is part of the compiler's output contract; they are listed here
because they are the renderer-compat vocabulary a reader of this document will look for.

| Node             | Presentation | Renders                                                                                                                        |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `RepeatInstance` | `stacked`    | One `<fieldset>` per live instance, its `<legend>` holding the instance heading (task 073).                                    |
| `RepeatTable`    | `table`      | The `overflow-x: auto` scroll box, the `<table>`, its `<caption>`, the column headers and a `<tfoot>` column total (task 077). |
| `RepeatRow`      | `table`      | One `<tr>` per live instance, its `<th scope="row">` carrying the row label and the focus landing.                             |
| `RepeatCell`     | `table`      | One `<td>` per column per row, holding a member control or - where a per-instance rule hid it - nothing.                       |

**A table is a native `<table>` and never `role="grid"`** (ADR-43, Q10). APG states as a
defining property of the grid pattern that it "Requires the author to provide code that
manages focus movement inside it", so with scripting off a grid renders as a tab-trap-shaped
nothing, and this surface's no-JS claim is unqualified. The documented cost is one tab stop
per cell, which is the expected behaviour of the choice rather than a defect.

**A cell is a node because the cell count is structural.** A per-instance rule can hide a
member question in one instance and not in another; the stacked presentation drops the
control, and a table cannot, because a short row shears every later column off its header.
So a hidden member leaves its `RepeatCell` childless, which is an empty cell.

**Five column types, not seven** (Q12): `shortText`, `number`, `date`, `boolean`,
`singleChoice`. `longText` and `multiChoice` are refused at publish with
`TABLE_COLUMN_TYPE_NOT_ALLOWED`, whose message names the stacked presentation, which allows
all seven.

**Nothing in the compiler moved for the table presentation**, so `COMPILER_VERSION` did not
either: the template node already carried `presentation`, and the expansion is a render-time
transform on the same stored bytes. `golden/v4/repeat-table-group.a2ui.json` is an appended
corpus entry rather than a new generation.

### The field-name contract (compiler ↔ API)

The decoy submits under one well-known key, `HONEYPOT_FIELD_NAME = "website"`
(exported from `@roonga/qcms-a2ui-compiler`). The API submit handler reads the same key
off the request body (`config.antiAbuse.honeypotField`, defaulted from that
constant), so compiler and API agree on exactly one string. The name is
deliberately **not** a qcms question id (`q_…`, R6), so it can never collide with
a real control's `name`.

### Golden generations (the maintainable log)

The golden corpus is append-only (ADR-18). The guard covers the versioned
directories (`golden/v1/`, `golden/v2/`, …) and deliberately not `golden/README.md`,
whose prose has to stay editable to record each new generation; this list is still
the living record, and the two are kept in step:

- **`golden/v1/`** - compiler `0.0.0`: the task-011 launch mapping (no honeypot).
  Retained untouched and still asserted a valid `@a2ra/core` document forever
  (old stored snapshots render against it).
- **`golden/v2/`** - compiler `0.1.0` (task 026): adds the `Honeypot` decoy last
  in every step. Retained.
- **`golden/v3/`** - compiler `0.2.0` (issue #186): every heading carries `size`
  and `weight`, so a form title and a step title no longer render at the `Text`
  component's body defaults. The current generation the corpus runner recompiles
  against.

- **`golden/v4/`** - compiler `0.3.0` (task 073): the `RepeatGroup` template node.
  The seven forms carried over from `v3/` have no repeating group, so their compiled
  **documents are byte-identical** there and only the `compilerVersion` stamp moves
  (acceptance case 5). Two forms are appended, `repeat-open-group` and
  `repeat-count-sources`. The current generation the corpus runner recompiles against.

  **`a2uiSpecVersion` did not move with it**, and that is the `Honeypot` precedent
  rather than an omission: it is the pinned `@a2ra/core` **package** version, asserted
  against the installed package by `version.test.ts`, and a qcms-owned node type moves
  no vendored schema. Task 026 added `Honeypot` on the same terms and moved the
  compiler stamp alone.

A future breaking change adds `golden/v5/` and appends here.

## Locale

Text reaching the document is resolved via `resolveText(text, locale, defaultLocale)` with
the form's `defaultLocale` (single-locale launch); `compileForm`'s `options.locale` is the
future seam (R7 - no second locale before Phase 4).
