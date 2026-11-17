# Person name

**Use for:** a name a person gives for themselves or for someone else: full name, given name, family name, a previous name, a next of kin, a guarantor, a witness.

**Settings**

- One `shortText` per name part the form actually needs. Ask for one combined name unless the person tells you the parts are used separately.
- `required: true` for the applicant's own name. `required: false` for a middle name, a previous name and any second person.
- `constraints.maxLength: 100` per part, or 200 for a combined name.
- No `pattern`. A name can carry an apostrophe, a hyphen, a space and letters from any script, and a narrower rule refuses real names.
- `messages.required` in the form's own words: "We need the patient's full name."

**Cannot be expressed**

- Nothing for this type. A name is plain text with an upper length.

**Say this when asked for a letters-only rule**

> The name is left open to any letters, spaces, apostrophes and hyphens. A rule that allows only A to Z turns away real names, so the plan sets none. Tell me if you want one anyway.

**Corpus sources:** NSW driver licence (previous names), US naturalization N-400 (repeated name information), Canadian adult passport (applicant, guarantor, references), Australian passport B11 declaration (applicant separate from the person declaring), NHS new-patient questionnaire (next of kin).
