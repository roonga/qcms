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
- **The preview is the last panel rather than a card above the editor** (Code Owner,
  2026-09-27). It held the top of the column permanently for a question that is only asked at
  the end. It is a row like the others now, opening on the same screen, and it is the one panel
  that shows the STORED version rather than the document being typed - which it says out loud,
  and only while the two differ. It renders outside the `<form>`, because a compiled respondent
  view carries live controls of its own and every one of them inside the editor's form would be
  posted with the document.
- **The rail is styled like the form builder's** (Code Owner, 2026-09-27): the same `qcms-rail*`
  and `qcms-rail-steps*` row geometry, current-row mark, child nesting, issue badge and
  control block. Six classes of a look of its own are deleted with it.
- **Save sits in the screen's one heading row**, which reads `{questionId} · Version {n}`, carries
  the version's status tag once and ends with the button; `ManualSaveNote` is under it (issue 518,
  contract §6), before it in DOM order. The version card carries no heading of its own now and
  opens directly on its panel.

  It took three tries to get there, and the two that were withdrawn are why the third is written
  the way it is. At the foot of the editor's column and then as a sticky bar there, the control
  sat wherever the selected PANEL left it - measured at 1440: y=481 on Validation messages, 565 on
  Content, 848 on Options, and no control at all on Preview - so it travelled 367px between
  panels. Sticky also cost three separate defects: it sat inside the option grid's own stacking
  band, so the grid's insert affordance swallowed presses aimed at Save; it put the button in the
  viewport's bottom-left corner, where `next dev` paints its tools indicator and the harness runs
  the admin in dev mode; and because the §6 note wrapped to four lines inside it at 390 it covered
  the control a reader had just tabbed to, which is WCAG 2.2 SC 2.4.11 (Focus Not Obscured). In
  the card's header it stopped moving but said "Version 2" a third time, under a rail row and a
  collapsed rail summary that had each said it already.

  The heading row holds one control's height whether or not a control is in it, so the heading
  does not move between a draft and a frozen version either. The button is outside the form it
  submits, so it finds the form by id and calls `requestSubmit()` and reads the action's pending
  state across the same module seam the rail's rows use: the vendored `Button` forwards no `form`
  attribute and ADR-22 keeps it byte-identical to upstream.

`/questions/new` is unchanged and keeps no rail: it shows every panel at once, because creation is
one pass through a short document and there is nothing there to switch them with.
