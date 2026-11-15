# Date of birth

**Use for:** the respondent's own date of birth, or a child's, a patient's, a dependant's.

**Settings**

- `date`, `required: true` wherever the form identifies a person.
- `constraints.max`: a fixed date in the past, never left open. Use the date you are authoring on, written out in full. Without it the question accepts dates far into the future.
- `constraints.min`: a fixed date that rules out a typed year that cannot be a birth year. `1900-01-01` is a safe floor for an adult form.
- `messages.max` and `messages.min` in the form's own words: "A date of birth cannot be in the future."
- `help` naming the order the date is read in, when the form serves more than one country.

**Cannot be expressed**

- "Not in the future." The upper limit is a fixed date, so it stops being correct the day after you set it.
- "At least 18 years ago", or any age floor or ceiling that moves with time.
- An age worked out from the date. Nothing computes one, and no rule can read one.

**Say this**

> I set the latest date it accepts to today's date, so a year in the future is refused. That limit is a fixed date rather than a moving one, so it will need changing from time to time. If you need an age rule that stays right by itself, I cannot set one here.

**Corpus sources:** NHS new-patient questionnaire (patients over five years old), Australian Medicare enrolment MS004 (up to five people, newborn route), US American Community Survey (age-dependent questions), Canadian adult passport, US naturalization N-400.
