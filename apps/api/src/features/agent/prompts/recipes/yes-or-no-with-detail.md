# Yes or no, with a follow-up when the answer is yes

**Use for:** "Do you care for someone? If yes, who?", "Have you ever been disqualified? If yes, give details", "Was anyone else involved? If yes, their name".

**Settings**

- The yes or no question first: `boolean`, `required: true`.
- The follow-up questions after it, in the same step or a later one. Mark each `required: true`: a hidden question is never asked for, so a follow-up that is required only counts when it is on screen.
- One visibility rule: `when` is `{ op: "equals", questionId: <the yes or no question>, value: true }`, and `show` lists every follow-up question.
- A rule may only reveal something that comes after the question it reads, so put the follow-ups later in the form. A rule pointing backwards is refused.
- Where the follow-up applies to a no rather than a yes, use `value: false`.

**Cannot be expressed**

- A follow-up revealed by a choose several answer on the same step. That answer is only committed when the respondent leaves the group of tick boxes, so the reveal cannot happen while they are still in it. Put the follow-up on the next step. The product warns about this when the form is published.
- A rule reading a question that comes later in the form.

**Say this**

> The detail questions only appear when they answer yes, and they have to be filled in when they do. Nobody who answers no is asked for them, and nothing of theirs is kept.

**Corpus sources:** NHS new-patient questionnaire (caring-person details shown only on an affirmative answer, conditional stopped dates), NSW driver licence application (yes or no detail branches), Australian Medicare enrolment MS004 (question 1 routes four sections), ahm travel insurance claim.
