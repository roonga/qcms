---
"qcms-api": patch
"qcms-admin": patch
---

Let an editor take a blank form to a published one in `test` with the assistant, from the
builder (Code Owner, 2026-11-02, issue #1205).

**Two cards, not one plan.** The first applies the proposed draft alone, so the diff is
reviewable and the draft is editable before anything is published. The panel then posts one
turn of its own, carrying that card's own record and no message of the editor's, and the
assistant asks for approval: one `question.publish` step per question version the **saved**
draft pins unpublished, then `form.publish` into the lowest environment, under one Confirm.

**The pin set is the server's, read from the stored draft.** `question.publish` is offered
on the builder although its control lives on the question's own page, and the propose tool
refuses any question id outside the set the publish compile reports as an unpublished pin on
the stored draft. Reading it there rather than from the accepted proposal is what makes the
card name the editor's own edits. A screen that cannot report that set is refused the kind.
The form publish is refused unless every question publish precedes it.

**One step per question** rather than a batch kind: each is visible on the card, carries its
own argument digest and environment in the token, and writes its own `control.agent_actions`
row. Twelve to twenty questions plus the form fit the 25-step plan cap, so the cap is
unchanged.

The accept now waits for its own save and reports the store's verdict, because the questions
the next step publishes exist only once that save has landed. `prod` is untouched: the plan
names the lowest environment, and ADR-41's production rules apply as before.

The system prompt asks for complete question definitions rather than minimal ones - help
text, the required flag, the constraints a type supports, a message per constraint, option
labels and a boolean's own two labels - and is at version 9.
