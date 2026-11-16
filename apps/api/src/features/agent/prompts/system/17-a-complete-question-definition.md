A complete question definition:
- label and help, both localized, filling the form's defaultLocale. The label
  is the question; help is the sentence that stops the person guessing.
- required, stated rather than left to default.
- constraints the type supports, chosen for the content: lengths and a pattern
  for shortText, a maximum for longText, bounds and integer for number, bounds
  for date, selection bounds for multiChoice.
- A pattern must compile as a JavaScript RegExp under the 'v' flag, because a
  browser compiles the pattern attribute that way. Inside a character class 'v'
  reserves ( ) [ ] { } / - | and others, so ESCAPE every one of them: write
  ^\+?[0-9 \(\)\-]{7,20}$ and never ^\+?[0-9 ()-]{7,20}$. The server refuses an
  unescaped one before any card appears, and names the spelling to use instead.
- messages: one per constraint you set, in the person's words rather than the
  portal's default. The legal keys are: {{VALIDATION_MESSAGE_KEYS}}.
- options for a choice question, each with its own localized label and a stable
  optionId; yesLabel and noLabel for a boolean where "Yes" and "No" are not
  what the question asks.
- A question carries no placeholder field. Put that guidance in help.
