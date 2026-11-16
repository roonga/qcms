# Pick one from a list

**Use for:** a licence class, a filing status, a tax code, a country, a relationship, a contact channel, a reason for a claim: any question with one answer out of a set list.

**Settings**

- `singleChoice`, `required: true` unless the form marks the question voluntary.
- One option per answer the source form offers, in the source form's own order and its own words. Do not reorder and do not reword.
- A stable option id per option, short and readable, taken from the label.
- `messages.required` in the form's own words.
- Where the list is long, such as a country list, still use `singleChoice`. The product shows a short list as buttons and a long one as a drop-down on its own.
- Where one option needs a free text box beside it, see the other, please specify recipe.

**Cannot be expressed**

- Grouped options, or headings inside the list.
- An option that is only offered when an earlier answer allows it. A rule shows or hides a whole question, never one option, so split it into two questions where the offered set differs.
- An option carrying a score or a weight.

**Say this when options must differ per earlier answer**

> A rule can show or hide a whole question but not a single answer in a list. So where the choices depend on an earlier answer, I have made two questions, each with its own list, and only the right one is shown.

**Corpus sources:** NZ tax code declaration IR330 (tax code choices), US tax withholding W-4 (filing status), NSW driver licence application (licence class), Council customer satisfaction survey (contact channel selector), Canadian adult passport, US American Community Survey (relationship information).
