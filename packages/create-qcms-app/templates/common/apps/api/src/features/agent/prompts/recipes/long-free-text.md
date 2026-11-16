# A longer typed answer

**Use for:** a reason for a visit, a description of what happened, comments, a free text statement on a declaration, other information.

**Settings**

- `longText`, which shows as a box of several lines. Use it whenever the answer is sentences rather than a phrase.
- `constraints.maxLength`, always set. 2000 is a reasonable ceiling for a description; use the source form's own limit where it states one.
- `required: false` for comments, which the source form almost always leaves optional. `required: true` for a description a claim cannot be assessed without.
- `messages.maxLength` in the form's own words.

**Cannot be expressed**

- A minimum length. A longer answer carries an upper limit and nothing else, so "at least a sentence" cannot be set. A short text question does have a minimum, but it shows as a single line, so it is the wrong shape for sentences.
- A word count, a paragraph count, or a required number of lines.
- Any shape rule. A longer answer takes no format check.

**Say this**

> It is a box of several lines with a 2000 character ceiling. There is no way to insist on a minimum amount, so someone can type one word, and I have said in the guidance line what you are after.

**Corpus sources:** Course evaluation survey (optional comments), NHS new-patient questionnaire, Australian passport B11 general declaration (free text statement), Council customer satisfaction survey (comments), ahm travel insurance claim.
