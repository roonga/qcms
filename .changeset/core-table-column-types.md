---
"@roonga/qcms-core": minor
---

Refuse a column type a table presentation cannot hold (task 077, ADR-43, Q12 as
ruled 2026-09-29).

`presentation: "table"` lays a repeating group's instances out as rows and its
member questions as columns, and a cell is one control in one `<td>`. Two of the
seven question types do not fit one: a `longText` is taller than the row it sits
in, and a `multiChoice` is a column of unknown height whose own options have to be
read before it can be answered. The phone card reflow makes both worse.

- `TABLE_COLUMN_TYPES` names the five that do fit - `shortText`, `number`, `date`,
  `boolean`, `singleChoice` - with `isTableColumnType` over it. It is a constant
  rather than a literal at the check because the admin's library picker filters the
  library to the same five, and two lists that have to agree should be one list.
- `TABLE_COLUMN_TYPE_NOT_ALLOWED` is the publish refusal, reported **per column**
  rather than per group, because a publish report is always complete and an author
  fixing one of two would otherwise be sent round the loop twice. Its path carries
  the group, the question, the step and the refused type.
- **The message names the stacked presentation**, which allows all seven types, so
  an author refused here has somewhere to go. The refusal fires on the presentation
  and on nothing else: the same member list published as `stacked` or
  `perInstanceStep` is untouched, which is the asymmetry the ruling creates on
  purpose.
