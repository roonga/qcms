# A2UI mapping — question types → a2-react-aria components (task 011)

**Status: inventory complete · all seven question types map to real registry components.**
The `longText` gap that parked this task is resolved upstream: `@a2ra/core@1.0.0-preview.7`
ships a `TextArea` component (node type `"TextArea"`).

The A2UI spec is `@a2ra/core`'s exported Zod schemas (ADR-22). This document records the
registry inventory the compiler is allowed to target and the question-type → component
mapping. The compiler emits **only** components listed here; anything the registry lacks is
a cross-repo issue, never a local invention.

## Inventory source of truth

| What | Value |
| --- | --- |
| Registry listing | `@a2ra/core` exported `*Schema` set, 2026-07-20 |
| Schema package | `@a2ra/core@1.0.0-preview.7` (npm `latest`) — `a2uiSpecVersion` pins this |
| Validation surface | `A2NodeSchema` / `safeParseNode` (recursive) + each component's `*Schema` |

Note: `@a2ra/core` still exports a `VERSION` constant of `"0.1.0-preview.0"`, stale
relative to its own `package.json` (`1.0.0-preview.7`). qcms pins `a2uiSpecVersion` to the
**package version** it validates against, not the exported constant (upstream issue to
relay — unchanged since preview.6).

## Registry inventory (23 components, `1.0.0-preview.7`)

Form controls: `text-field` (TextField) · **`text-area` (TextArea) — new in preview.7** ·
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
(registry item name in parentheses). All schemas are `strict` on props — unknown props are
rejected, so the compiler emits only listed props. All constraint props are **advisory
client-side hints** — server-side domain validation (`validateAnswer`, task 009) is the
authority.

| Question type | Component | Props (from question) | Advisory hints (from constraints) |
| --- | --- | --- | --- |
| `shortText` | `TextField` (`text-field`) | `label`, `description` (help), `name` = questionId | `isRequired`, `minLength`, `maxLength`, `pattern` |
| `longText` | `TextArea` (`text-area`) | `label`, `description` (help), `name` = questionId | `isRequired`, `maxLength` |
| `number` | `NumberField` (`number-field`) | `label`, `description`, `name` | `isRequired`, `minValue`, `maxValue`, `step: 1` when `integer` |
| `date` | `DatePicker` (`date-picker`) | `label`, `description`, `name`, `granularity: "day"` | `isRequired`, `minValue`, `maxValue` (canonical `YYYY-MM-DD` strings) |
| `boolean` | `RadioGroup` (`radio`) with two `Radio` children, values `"true"` / `"false"` | `label`, `description`, `name`; child labels are locale-resolved Yes/No text | `isRequired` |
| `singleChoice` (≤ 7 options) | `RadioGroup` (`radio`) with one `Radio` per option, `value` = optionId | `label`, `description`, `name`; child `label` from option label | `isRequired` |
| `singleChoice` (> 7 options) | `Select` (`select`) with `items` (`value` = optionId) | `label`, `description`, `name`, `items` | `isRequired` |
| `multiChoice` | `CheckboxGroup` (`checkbox`) with one `Checkbox` child per option, `value` = optionId | `label`, `description`, `name`, `orientation: "vertical"` | `isRequired` (min/maxSelected have no upstream prop — server-only, surfaced in help text by authors if desired) |

### Documented choices

- **`longText` → `TextArea`, not a single-line `TextField`.** Now that the registry has a
  real multiline control, `longText` maps to it directly. The compiler does **not** set a
  `rows` value — the domain has no such property and a fixed guess would freeze a UX
  decision into immutable snapshots; the renderer's default height applies. `maxLength` is
  forwarded as an advisory hint (`longText` constraints carry `maxLength` only).
- **`boolean` → yes/no `RadioGroup`, not a single `Checkbox`.** A lone checkbox conflates
  "unanswered" with "false" and turns `required` into consent-must-check semantics. The
  kernel distinguishes unanswered from `false` (the `answered` operator, ADR-16 hidden
  exclusion), so the control must too. Radio values are the strings `"true"`/`"false"`,
  mapped to the canonical boolean `AnswerValue` at the answer boundary. Yes/No child labels
  come from a compiler affirmation lexicon keyed by the locale's language subtag
  (`BOOLEAN_AFFIRMATION`), English fallback; the lexicon is a compiler constant frozen into
  output via `compilerVersion`, and gains entries alongside each new launch locale (R7 — no
  second locale before Phase 4).
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
- Headings: form title as `Text(as: "h1")` on the first step only; step title as
  `Text(as: "h2")` on every step — the renderer maps these to the page heading outline.
- Every control carries `label` and, when the question has help text, `description`
  (upstream renders these with the correct ARIA associations; component-level a11y is
  tested upstream per ADR-22).
- Error slots: every control node leaves `errorMessage` **unset** in compiled output —
  it is the per-question error slot the renderer (028) fills from server validation
  results. The `name` prop (= questionId) is the key the renderer uses to route errors.

## Locale

Text reaching the document is resolved via `resolveText(text, locale, defaultLocale)` with
the form's `defaultLocale` (single-locale launch); `compileForm`'s `options.locale` is the
future seam (R7 — no second locale before Phase 4).
