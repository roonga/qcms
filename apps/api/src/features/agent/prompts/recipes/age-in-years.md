# Age in years

**Use for:** an age the respondent states directly, rather than one worked out from a date of birth.

**Settings**

- `number`, `constraints.integer: true`.
- `constraints.min: 0` and a `constraints.max` the form can defend: 120 for a person's age, or the form's own floor where it has one.
- `required` as the form needs it.
- `messages.min`, `messages.max` and `messages.integer` in the form's own words: "Enter an age in whole years."

**Cannot be expressed**

- Agreement between a stated age and a date of birth given elsewhere. No rule compares two answers, so a form that asks for both can hold two that disagree.

**Say this when the form holds both**

> This asks for the age straight out. If the form also asks for a date of birth, nothing checks that the two agree, so a person can give an age that does not match their birth date. Asking for the birth date alone avoids that.

**Corpus sources:** US American Community Survey (age-dependent questions), US BRFSS health survey (demographic skip logic), NHS new-patient questionnaire.
