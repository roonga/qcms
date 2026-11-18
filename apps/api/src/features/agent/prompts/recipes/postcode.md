# Postcode

**Use for:** a postcode, a postal code, a ZIP code.

**Settings**

- `shortText`, never `number`, because a postcode can start with a zero or carry letters.
- For the one country the form serves, take the shape, the cap and the wording from this set unchanged, as `constraints.pattern`, `constraints.maxLength` and `messages.pattern`:
  - Australia: `^\d{4}$`, `maxLength: 4`, "An Australian postcode is four digits."
  - Canada: `^[ABCEGHJ-NPRSTVXYabceghj-nprstvxy]\d[A-CEGHJ-NPRSTV-Za-ceghj-nprstv-z] ?\d[A-CEGHJ-NPRSTV-Za-ceghj-nprstv-z]\d$`, `maxLength: 7`, "A Canadian postal code looks like K1A 0B1."
  - New Zealand: `^\d{4}$`, `maxLength: 4`, "A New Zealand postcode is four digits."
  - United Kingdom: `^(?:[Gg][Ii][Rr] ?0[Aa]{2}|[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2})$`, `maxLength: 8`, "A UK postcode looks like SW1A 1AA."
  - United States: `^\d{5}(?:-\d{4})?$`, `maxLength: 10`, "A ZIP Code is five digits, or five digits, a hyphen and four more."
- The Canadian and UK shapes take either case and accept the separating space being left out.
- For any other country, and wherever the form serves several, set no `pattern` and use `constraints.maxLength: 12` instead. Only the five shapes above are checked, so do not write one for another country from memory.

**Cannot be expressed**

- A rule that depends on the country answered elsewhere. No constraint reads another answer, so a single postcode question cannot change its shape per country.
- Whether the postcode exists, or matches the suburb or state given.
- A lookup that fills in the suburb.

**Say this when the form serves more than one country**

> The postcode is left open, because the shape differs per country and the check cannot follow the country they pick. If the form only ever serves one country, tell me which and the plan can tighten it.

**Corpus sources:** Council customer satisfaction survey (contact details), NHS new-patient questionnaire, Canadian adult passport (address history), US American Community Survey.
