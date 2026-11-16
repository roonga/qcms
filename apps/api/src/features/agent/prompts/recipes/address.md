# Address

**Use for:** a residential address, a postal address, an address history, a hospital or provider address.

**Settings**

- One `shortText` per line the form uses: street address, second address line, suburb or city, state or province. Add the postcode as its own question and the country as a `singleChoice`.
- `required: true` on street address, suburb or city, and postcode. `required: false` on the second line.
- `constraints.maxLength: 100` per line, 60 for suburb or city.
- No `pattern` on the street lines.
- Where the form collects several addresses, see the repeating items recipe.

**Cannot be expressed**

- An address lookup or autocomplete. Nothing reaches outside the form.
- Agreement between postcode, suburb, state and country.
- A set of lines that changes with the country chosen.

**Say this**

> These are plain boxes with an upper length. There is no address lookup, so nothing checks that the suburb and the postcode belong together.

**Corpus sources:** Canadian adult passport (address history), Australian passport B11 declaration (international address fields), US health insurance claim CMS-1500 (patient, insured and provider addresses), NHS new-patient questionnaire.
