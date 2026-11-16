# A short typed answer, with a length limit

**Use for:** a job title, an occupation, a place of birth, a short reason, an enquiry capped at a number of characters.

**Settings**

- `shortText`, `required` as the form needs it.
- `constraints.maxLength` set to the source form's own limit where it states one, and to a defensible figure where it does not.
- `constraints.minLength` only where a very short answer is genuinely useless, and never above 2 or 3. A minimum length refuses an answer that is real but brief.
- `messages.maxLength` and `messages.minLength` in the form's own words: "Keep this under 100 characters."
- No `pattern` unless the answer has a set shape. See the reference number recipe for that case.

**Cannot be expressed**

- A word count. The limit counts characters.
- A limit that counts the way the person counts it. The count is of characters as the typed box counts them, which differs from a count of letters for text with accents or non-Latin scripts.
- A soft limit that warns rather than refuses.

**Say this**

> The box stops at 100 characters, which is the limit on the form you gave me. It is a hard stop rather than a warning, and it counts characters, not words.

**Corpus sources:** Council customer satisfaction survey (100 character enquiry limit, required versus optional contact inputs), Canadian adult passport (occupation history), US naturalization N-400, US American Community Survey.
