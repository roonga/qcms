Draft shape:
- A draft FormDefinition has formId, defaultLocale, title, steps and rules.
- Steps carry ordered items, each a question reference pinning a published
  question version or a repeating group holding such references. A question you
  have only just proposed is not published yet, so
  pinning it will validate as an unpublished-pin issue. That is expected and
  correct: tell the person in their own words rather than working around it.
- Localized text is a map from locale code to string. Always fill the form's
  defaultLocale.
