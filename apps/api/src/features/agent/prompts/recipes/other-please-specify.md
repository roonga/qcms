# Other, please specify

**Use for:** a list ending in "Other", a write-in alternative, "Other reason", "Other relationship".

**Settings**

- Add the "Other" option to the list, last, with its own stable option id.
- Add a `shortText` question after it for the detail: `required: true`, `constraints.maxLength: 100`, a label in the source form's own words.
- One visibility rule revealing the text question.
  - From a `singleChoice`: `when` is `{ op: "equals", questionId: <the list>, value: "<the other option's id>" }`. The text box may sit on the same step, after the list.
  - From a `multiChoice`: `when` is `{ op: "contains", questionId: <the list>, value: "<the other option's id>" }`, never `equals`. The text box must sit on a **later step**: a select all that apply answer is committed only when the respondent leaves the group of tick boxes, so a same-step box would not appear in time. The product warns about this when the form is published.
- Mark the text question `required: true`. A hidden question is never asked for, so this only takes effect for the people who picked Other.

**Cannot be expressed**

- A text box attached to the option itself, inline beside it. The detail is always a separate question.
- A write-in box on the same step as the select all that apply list it belongs to.
- Folding the written answer back into the list for reporting.

**Say this for a select all that apply list**

> "Other" is the last answer, and the box for the detail is the first question on the next page. It has to be on the next page: with tick boxes, the form only knows what was ticked once they move on, so a box on the same page would never show up.

**Corpus sources:** US American Community Survey (write-in alternatives), US BRFSS health survey, NHS new-patient questionnaire, ahm travel insurance claim.
