# A quantity, a count, or a measurement

**Use for:** how many people, how many dependants, how many service units, how many days, a height, a weight.

**Settings**

- `number` with `constraints.integer: true` for a count, and `integer: false` for a measurement that can carry a fraction.
- `constraints.min: 0`, or the form's own floor, and always a `constraints.max` the form can defend. Without an upper bound the question accepts any number at all.
- `messages.min`, `messages.max` and `messages.integer` in the form's own words: "Enter a whole number of days."
- Where the count decides how many times a set of questions is asked, see the repeating items recipe: the count question must come before the group and must be a number question outside every group.
- For a measurement, name the unit in the label, as in "Height in centimetres". Ask for one unit only.

**Cannot be expressed**

- A unit chosen by the respondent, with the value converted. Where the source form offers metric and imperial, either pick one unit or ask two questions and tell the person only one will be filled in.
- A step or an interval other than whole numbers, such as multiples of five.
- A count checked against something counted elsewhere.

**Say this when the source form offers two units**

> This asks for centimetres only. The form cannot offer a choice of units and convert between them, so either we pick one, or I add a second question for inches and you get one filled in and one empty.

**Corpus sources:** US health insurance claim CMS-1500 (service units), Canadian adult passport (metric and imperial height units), US tax withholding W-4 (dependants), Australian Medicare enrolment MS004 (up to five people), US American Community Survey.
