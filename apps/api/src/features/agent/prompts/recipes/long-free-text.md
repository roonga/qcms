# Longer answer

**Use for:** a reason for a visit, a description of what happened, comments, a free text statement on a declaration, other information.

**Settings**

- `longText`, which shows as a box of several lines. Use it whenever the answer is sentences rather than a phrase.
- `constraints.maxLength`, always set. 2000 is a reasonable ceiling for a description; use the source form's own limit where it states one.
- `constraints.minLength`, set whenever the person asks for sentences rather than a phrase, or a very short answer would be useless. Set it low, around 40 characters: a floor counts characters, so one high enough to force a sentence also turns away a real answer that is simply brief. Asking for "a few sentences" is an ASK FOR A FLOOR, not a reason to leave it out, so set one and say what it does.
- `required: false` for comments, which the source form almost always leaves optional. `required: true` for a description a claim cannot be assessed without.
- `messages.maxLength`, and `messages.minLength` where you set a floor, in the form's own words.

**Cannot be expressed**

- A word count, a paragraph count, or a required number of lines. Both lengths count characters.
- A floor counted the way an author states it. "At least a sentence" becomes a character count, which cannot tell a sentence from the same number of characters of anything else. Set the floor anyway and say what it does and does not catch.
- Any shape rule. A longer answer takes no format check.

**Say this**

> It is a box of several lines with a 2000 character ceiling, and fewest characters set to 40 so a one word reply is turned away. That floor counts characters rather than sentences, so it cannot insist on a whole sentence; the help text is what says what you are after.

**Corpus sources:** Course evaluation survey (optional comments), NHS new-patient questionnaire, Australian passport B11 general declaration (free text statement), Council customer satisfaction survey (comments), ahm travel insurance claim.
