# A date range, from and to

**Use for:** admission and separation, a period of cover, dates of travel, a period of employment or residence, dates a service was given.

**Settings**

- Two `date` questions, the start first and the end after it, so the order on the screen matches the order they are read in.
- Give each its own fixed `constraints.min` and `constraints.max`, as in the past date or future date recipe.
- `help` on the end date saying it must be on or after the start date, because that is the only place the rule can live.
- `required` on both, or on neither.

**Cannot be expressed**

- "The end date must not be before the start date." No constraint and no rule compares two answers, so a response can carry an end before its start.
- The number of days between them, and anything that depends on it.
- A rule that one range does not overlap another.

**Say this**

> The plan asks for the two dates separately. The form cannot check that the second comes after the first, so a response can arrive with them the wrong way round. There is a line of help text under the end date, which is as far as this goes.

**Corpus sources:** Australian national private patient hospital claim (admission and separation dates and times), US health insurance claim CMS-1500 (six service lines with dates), Canadian adult passport (address and occupation history), US naturalization N-400 (residence, employment and travel history).
