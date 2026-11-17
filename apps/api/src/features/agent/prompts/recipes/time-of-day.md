# A time of day

**Use for:** an admission time, a time of an accident, a time of a call, an appointment time.

**Settings**

- There is no time question. Choose one of two, and say which you chose and why:
  - a `singleChoice` over named parts of the day, or over hourly or half-hourly slots, when a set list will do. This is the one to prefer: every answer is then a value the form can compare and report on.
  - a `shortText` with `constraints.pattern: ^([01]\d|2[0-3]):[0-5]\d$`, `constraints.maxLength: 5` and `help` giving the 24 hour form, when an exact time is needed.
- `messages.pattern`: "Enter a time as hours and minutes, like 14:30."

**Cannot be expressed**

- A time question. The set of types holds text, long text, number, date, yes or no, single choice and select all that apply, and nothing else.
- A date and a time as one answer.
- Ordering or comparison over a typed time. A text answer is not ordered, so no rule can ask whether one time is before another.

**Say this**

> There is no time question in this product, so the plan uses a list of times to pick from. That keeps every answer tidy. If you need an exact time typed in the plan can do that instead, as a text box that checks the shape, but then nothing can compare one time with another.

**Corpus sources:** Australian national private patient hospital claim (admission and separation dates and times), ahm travel insurance claim, US BRFSS health survey.
