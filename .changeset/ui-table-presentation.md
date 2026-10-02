---
"@roonga/qcms-ui": minor
---

Render a repeating group as a native table (task 077, ADR-43, Q10 and Q12).

`presentation: "table"` lays instances out as rows and member questions as columns.
Under ADR-42 no question type is added: every cell is an ordinary question with an
ordinary `AnswerValue`, so this package gains a **layout** rather than an input
control.

**It is a native `<table>` and never `role="grid"`.** APG states as a defining
property of the grid pattern that it "Requires the author to provide code that
manages focus movement inside it", so with scripting off a grid renders as a
tab-trap-shaped nothing, and the portal's no-JS claim is unqualified. APG also
prefers the native element outright and its two optimal cell designs exclude a text
input. The documented cost is one tab stop per cell, which is the expected behaviour
of the choice and not a defect to mitigate with script; the mitigation is the group's
own `max`.

- Three render-time node types, `RepeatTable`, `RepeatRow` and `RepeatCell`, because
  a native table has a fixed element nesting and a node's children render with no
  wrapper of their own. A cell is a node for a second reason: the cell count is
  **structural**, so a member question a per-instance rule hid leaves its cell
  behind, empty, instead of shearing every later column off its header.
- A `<caption>` carrying the group's label, a `<th scope="col">` per column and a
  `<th scope="row">` per row, which is also the row's focus landing after an Add or a
  Remove (`id`, `tabindex="-1"`, and `autofocus` without scripting).
- **A real, visually hidden `<label>` on every input**, reading "Vehicle 3, Odometer
  reading". `scope` and `headers` associate a _cell_ with its header cells and no
  source found claims they name the _input_; the 390px reflow then removes the header
  cells altogether. A real label per cell is the only encoding that survives both
  layouts, so it is clipped by CSS rather than switched at a breakpoint.
- A `<tfoot>` column total for a `number` column: computed presentation, never an
  input, never posted, never stored, never submitted, never exported.
- The 390px card reflow, one card per row, where the clipped label and hint become
  visible outright. Above it the table lives in its own `overflow-x: auto` box, which
  is the only element on a portal page permitted to scroll horizontally, and
  `position: relative` on that box and on every cell is load-bearing: a visually
  hidden label positioned inside an overflow box with no positioned ancestor resolves
  against the initial containing block and widens the **document**.
- `useQcmsValues` and `useQcmsLocale`, for a presentation whose content is a function
  of a column rather than of a field: a hook per cell in a loop whose length changes
  when a row is added is a rules-of-hooks violation.

No compiler stamp moves and no golden document is rewritten: the template node already
carried `presentation`, and the expansion is a render-time transform on the same stored
bytes (ADR-18).
