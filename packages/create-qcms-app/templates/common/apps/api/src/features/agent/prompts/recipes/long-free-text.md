# A longer typed answer

**Use for:** a reason for a visit, a description of what happened, comments, a free text statement on a declaration, other information.

**Settings**

- `longText`, which shows as a box of several lines. Use it whenever the answer is sentences rather than a phrase.
- `constraints.maxLength`, always set. 2000 is a reasonable ceiling for a description; use the source form's own limit where it states one.
- `constraints.minLength` only where a very short answer is genuinely useless, and set low. It counts characters, so a floor high enough to force a sentence also refuses a real answer that is simply brief.
- `required: false` for comments, which the source form almost always leaves optional. `required: true` for a description a claim cannot be assessed without.
- `messages.maxLength`, and `messages.minLength` where you set a floor, in the form's own words.

**Cannot be expressed**

- A word count, a paragraph count, or a required number of lines. Both lengths count characters.
- A minimum stated the way an author states it, as "at least a sentence" or "at least a few words". A floor counts characters, and cannot tell a sentence from the same number of characters of anything else.
- Any shape rule. A longer answer takes no format check.

**Say this**

> It is a box of several lines with a 2000 character ceiling. A shortest answer can be set too, but it counts characters rather than sentences, so it stops a one word answer and little more; the guidance line is what says what you are after.

**Corpus sources:** Course evaluation survey (optional comments), NHS new-patient questionnaire, Australian passport B11 general declaration (free text statement), Council customer satisfaction survey (comments), ahm travel insurance claim.
