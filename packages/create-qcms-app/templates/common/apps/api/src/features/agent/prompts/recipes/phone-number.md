# Phone number

**Use for:** a contact number, a mobile, a daytime number, a next of kin's number.

**Settings**

- `shortText`, never `number`. A leading zero and a leading plus both matter and a number drops them.
- `constraints.pattern: ^\+?[0-9 \(\)\-]{7,20}$`. Escape the brackets and the hyphen: a browser refuses the unescaped spelling.
- `constraints.maxLength: 20`.
- `messages.pattern` in plain words: "Enter a phone number. Digits, spaces, brackets and a leading plus are all fine."
- `help` saying whether an international number is wanted, when the form crosses borders.

**Cannot be expressed**

- There is no phone type and no per-country check.
- Whether the number is real, reachable, mobile or landline.
- A rule that a number from one country must follow that country's own shape.

**Say this**

> It accepts digits, spaces, brackets and a leading plus, between seven and twenty characters. That lets through numbers from anywhere, which also means it lets through a number that is the wrong length for its own country.

**Corpus sources:** Australian passport B11 declaration (international address and phone fields), NHS new-patient questionnaire, Council customer satisfaction survey, ahm travel insurance claim.
