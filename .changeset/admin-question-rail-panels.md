---
"qcms-admin": minor
---

The question detail screen shows one editor panel at a time, chosen from the rail (Code Owner,
2026-09-27).

The editor was one column: the label, the help text, the required box, the option grid, the
constraint panel, the message fields and the boolean labels stacked, with Save below all of them.
On a nine-option single choice that is a screen and a half of scrolling to reach a constraint, and
the save is somewhere past the end of it.

The rail beside the column now nests **panel rows** under the selected version's row, the way the
form builder's rail nests a form's steps, and the column shows the preview plus the one panel the
address names. Six consequences worth reading before changing any of it:

- **Which panels exist is derived, never listed.** `lib/questions/panels.ts` reads the same three
  functions the editor already rendered from - `hasOptions`, `CONSTRAINT_FIELDS` and
  `authoredMessageKeys` - so a type that gains a constraint gains a Constraints panel with no edit
  anywhere, and the rail cannot offer a row the editor has nothing to open. `renderedFields`, which
  was a second hand-written list of the same relationship inside the editor, is gone: the set the
  error summary tests an issue against is now the union of the panels' own fields.
- **A panel is absent rather than empty.** A boolean has no constraints to set and a question with
  nothing set has no message to write, so those panels do not exist rather than standing there
  explaining themselves. `questions.editor.noConstraints` and `questions.message.none` are deleted
  with the branches that rendered them: an empty state is the absence of a rail row now.
- **The open panel is in the address** as `?panel=`, resolved on the server by one pure function
  both trees read (`panelFromParams`), so the marked row and the rendered panel agree on first
  paint and a reload or a pasted link lands where the author was. A query parameter rather than a
  fragment because a fragment never reaches the server, and both halves of this screen are
  server-rendered from the address.
- **A refused save opens the first panel carrying an issue and moves focus to the offending
  control**, or focuses the error summary when no panel can show what was refused. With one panel
  on screen that is what keeps task 032's "every error surfaced somewhere readable" true, and it is
  the editor's own path rather than the rail's: below `--bp-sidebar` the rail is a shut
  `<details>`, and the switch and the focus still work.
- **The question's own details and the way back moved into the rail.** The meta strip (slug,
  created day, type) was a paragraph of facts about the question sitting above one panel of one
  version of it, and the back link was the one thing in that column that went somewhere else. The
  type is now stated **once**, with its locked status, beside the question's other permanent facts
  (R6); the second statement of it inside the version card is deleted, and
  `questions.editor.typeLocked` with it.
- **Save stays in the column, as a sticky footer of the version card.** It is deliberately not
  moved into the rail, which collapses to a shut disclosure on a narrow viewport - a save an author
  has to expand a navigation to reach is worse than one they have to scroll to. `ManualSaveNote`
  travels with it (issue 518, `plan/admin-design-contracts.md` §6).

`/questions/new` is unchanged and keeps no rail: it shows every panel at once, because creation is
one pass through a short document and there is nothing there to switch them with.
