# Select all that apply

**Use for:** which services you used, which reasons apply to this claim, which conditions you have, which languages you speak.

**Settings**

- `multiChoice`, with one option per answer the source form offers, in its order and its words, each with a stable option id.
- `constraints.minSelected: 1` where at least one answer is needed. Set that rather than `required: true` alone, and set `required: true` as well.
- `constraints.maxSelected` only where the source form caps the count, such as "choose up to three".
- `messages.minSelected` and `messages.maxSelected` in the form's own words: "Pick at least one. Pick as many as apply."
- Where a "none of the above" option is wanted, read the none of the above recipe first: the exclusive behaviour cannot be set.

**Cannot be expressed**

- An option that cancels the others when it is ticked.
- A rule that two particular options cannot be ticked together.
- A required count that depends on another answer.
- A follow-up question revealed on the same step by what was ticked. The answer is committed only when the respondent leaves the group of tick boxes, so put any follow-up on the next step.

**Say this**

> They can tick as many as apply, and I have made at least one answer necessary. Rules about which answers can go together are not something the form can hold.

**Corpus sources:** US American Community Survey (select-all responses), ahm travel insurance claim (multiple claim reasons together), NHS new-patient questionnaire, US BRFSS health survey, Council customer satisfaction survey.
