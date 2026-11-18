# A voluntary question, and answers that are not answers

**Use for:** a voluntary demographic question, and for the refused, do not know, and not asked codes an interviewer-run questionnaire records.

**Settings**

- `required: false` for a question the source form marks voluntary, and say so in the label or in `help`, in the source form's words.
- Where the source form records an explicit non-answer, make it an option rather than leaving the question blank: add "Prefer not to say", or "Do not know", to the `singleChoice` or `multiChoice` list with its own stable option id. A blank and a deliberate refusal then stay apart in the results.
- Keep every non-answer code the source form distinguishes as its own option. Refused and do not know are different answers and must not be merged.
- Where a later question should be skipped after a non-answer, write the rule off the ordinary answers rather than off the non-answer: list the answers that reveal the follow-up with `in` or `containsAny`.

**Cannot be expressed**

- A per-question "not asked" state. Not asked is the absence of an answer, and a voluntary question left blank is stored as nothing at all.
- An answer marked as a non-answer in reporting. An option is an option, and nothing tags one as special.
- An interviewer-only instruction attached to a question. Put spoken question text in the label and anything else in `help`, which the respondent sees.

**Say this**

> The plan makes "Prefer not to say" a real answer rather than letting people leave it blank. That way you can tell the difference between someone who chose not to say and someone who just skipped it.

**Corpus sources:** US BRFSS health survey (refusal, do-not-know and not-asked codes preserved separately from ordinary choices; interviewer-only routing), Australian Medicare enrolment MS004 (voluntary demographic questions), NSW driver licence application (voluntary questions preserved), US American Community Survey.
