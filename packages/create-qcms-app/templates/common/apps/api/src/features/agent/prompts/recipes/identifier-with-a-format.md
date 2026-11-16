# Reference number with a set format

**Use for:** a passport number, a licence number, a Medicare card number, a tax number, a policy or membership number, a bank account number, a claim reference.

**Settings**

- `shortText`, never `number`. A number drops a leading zero and shows grouping separators, and these codes keep both.
- `constraints.pattern` matching the exact shape, anchored at both ends: `^\d{8,9}$` for an eight or nine digit tax number, `^[A-Z]\d{7}$` for a letter and seven digits.
- Escape every character class member that a browser's own check reserves: write `^[A-Z0-9 \-]{6,12}$`, never `^[A-Z0-9 -]{6,12}$`.
- `constraints.minLength` and `constraints.maxLength` as well, so the length is refused even where the shape is not.
- `messages.pattern` describing the shape in words, never by quoting the rule: "A tax number is eight or nine digits with no spaces."
- `help` giving one example of a correct value.

**Cannot be expressed**

- A check digit, a checksum, or any arithmetic over the value.
- A lookup against the issuer. Nothing reaches outside the form.
- Case folding. The rule is applied to what was typed, so allow both cases or say in `help` which to use.

**Say this**

> I check the shape: how many characters, and which ones. Whether the number really exists, and whether its check digit adds up, is not something the form can work out, so a well shaped but wrong number will get through.

**Corpus sources:** NZ tax code declaration IR330 (eight or nine digit tax number, leading zeros kept), US health insurance claim CMS-1500 (coded values), Australian Medicare enrolment MS004, NSW driver licence, Canadian adult passport (previous travel documents).
