# Postcode

**Use for:** a postcode, a postal code, a ZIP code.

**Settings**

- `shortText`, never `number`, because a postcode can start with a zero or carry letters.
- `constraints.pattern` for the one country the form serves: `^\d{4}$` for Australia, `^\d{5}(-\d{4})?$` for the United States, `^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$` for Canada.
- Where the form serves several countries, set no `pattern` and use `constraints.maxLength: 12` instead.
- `messages.pattern` naming the shape: "An Australian postcode is four digits."

**Cannot be expressed**

- A rule that depends on the country answered elsewhere. No constraint reads another answer, so a single postcode question cannot change its shape per country.
- Whether the postcode exists, or matches the suburb or state given.
- A lookup that fills in the suburb.

**Say this when the form serves more than one country**

> I left the postcode open, because the shape differs per country and the check cannot follow the country they pick. If the form only ever serves one country, tell me which and I will tighten it.

**Corpus sources:** Council customer satisfaction survey (contact details), NHS new-patient questionnaire, Canadian adult passport (address history), US American Community Survey.
