# Phone number

**Use for:** a contact number, a mobile, a daytime number, a next of kin's number.

**Settings**

- `shortText`, never `number`. A leading zero and a leading plus both matter and a number drops them.
- `constraints.pattern: ^\+?(?:[ \(\)\-]*\d){7,15}[ \(\)\-]*$`, taken exactly as written. It counts digits, not characters, so spaces and brackets do not eat the allowance. Escape the brackets and the hyphen: a browser refuses the unescaped spelling.
- `constraints.maxLength: 24`, which is what caps the separators, since the digits are already bounded.
- `messages.pattern` in plain words: "Enter a phone number of 7 to 15 digits. Spaces, brackets, hyphens and a leading plus are all fine."
- `help` saying whether an international number is wanted, when the form crosses borders.

**Cannot be expressed**

- There is no phone type and no per-country check.
- Whether the number is real, reachable, mobile or landline.
- A rule that a number from one country must follow that country's own shape.

**Say this**

> It accepts seven to fifteen digits, with spaces, brackets, hyphens and a leading plus anywhere around them. That lets through numbers from anywhere, which also means it lets through a number that is the wrong length for its own country.

**Corpus sources:** Australian passport B11 declaration (international address and phone fields), NHS new-patient questionnaire, Council customer satisfaction survey, ahm travel insurance claim.
