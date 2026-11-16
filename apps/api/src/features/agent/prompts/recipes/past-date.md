# A date that has already happened

**Use for:** an admission date, a date of an accident, the date someone stopped smoking, a date of arrival, the date a previous document was issued.

**Settings**

- `date`, `required` as the form needs it.
- `constraints.max`: the date you are authoring on, written out in full. This is what stops a date in the future.
- `constraints.min`: a floor the form can defend. Use the earliest date the question could sensibly mean, not an open bound.
- `messages.max` in the form's own words: "This date cannot be in the future."
- Where the date is only asked after a yes, put it behind a rule rather than making it required for everyone. See the yes or no with a detail follow-up recipe.

**Cannot be expressed**

- "Not in the future." The upper limit is a fixed date, so it is right on the day you set it and wrong afterwards.
- "Within the last twelve months", or any window measured from the day the form is filled in.
- A limit read from another answer, such as "after the date of birth".

**Say this**

> The latest date it accepts is today's date, set as a fixed date. It will stop being right as time passes, so it needs changing from time to time. A window such as "in the last year" is not something I can set.

**Corpus sources:** Australian national private patient hospital claim (admission and separation dates), ahm travel insurance claim (medical and cancellation claims), NHS new-patient questionnaire (conditional stopped dates), Canadian adult passport (previous travel documents).
