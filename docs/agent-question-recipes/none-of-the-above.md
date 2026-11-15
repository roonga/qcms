# None of the above, and other answers that stand alone

**Use for:** "None of these", "I did not contact you", "No conditions apply", "Not applicable", "Prefer not to say" on a select all that apply question.

**Settings**

- Add the option to the `multiChoice` list, last, with its own stable option id, exactly as the source form words it.
- Leave `constraints.maxSelected` unset. A cap of 1 would also forbid two ordinary answers, which is not the rule the form wants.
- `required: true`, so the question cannot be left empty. An empty selection is refused in any case.
- Put the rule the form cannot hold into `help`, in the respondent's words: "If none of these apply, pick the last answer on its own."
- Tell the person plainly, before they confirm, that the option can be ticked alongside the others.

**Cannot be expressed**

- An option that cannot be ticked with the others. There is no exclusive option, and nothing refuses a response that ticks "none of these" together with two ordinary answers. Neither the screen nor the server stops it.
- A rule between two options of one question.
- A warning at the time of filling in.
- Putting the standalone answer on its own single-choice question first and revealing the list afterwards does work, and it is two questions where the source form has one. Offer it only where the person says the rule matters more than the shape of the form.

**Say this**

> I added "None of these" as the last answer. One thing I cannot do: stop someone ticking it as well as the others. The form will accept both, and nothing flags it. I have put a line of guidance under the question, and if that is not enough I can split it into two questions instead: first whether any apply, and then the list.

**Corpus sources:** US American Community Survey (not-applicable routes), US BRFSS health survey (refusal and do-not-know codes kept separate from ordinary choices), Council customer satisfaction survey, Australian Medicare enrolment MS004 (voluntary demographic questions).
