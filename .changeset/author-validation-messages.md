---
"@roonga/qcms-core": minor
"@roonga/qcms-a2ui-compiler": minor
"@roonga/qcms-ui": minor
---

Author-supplied validation messages (ADR-32, folds issue #22) and boolean yes/no
label overrides (ADR-36). Both are **presentation payload**: the kernel and API
stay the validation authority and keep emitting stable error codes, and the wire
values of a boolean answer never move.

`@roonga/qcms-core` (minor: additive-optional schema plus new exports).

- The question definition gains an optional `messages` map, one `LocalizedText`
  per constraint the question carries, versioned with the question (R6). A
  boolean definition additionally gains optional `yesLabel` and `noLabel`
  `LocalizedText` fields, each independently optional. All three are
  additive-optional: content stored before this change parses with none of the
  new keys present and round-trips byte-identically.
- New exports: `ValidationMessageKey` (the closed authorable constraint set:
  `required`, `minLength`, `maxLength`, `pattern`, `min`, `max`, `integer`,
  `minSelected`, `maxSelected`), `VALIDATION_MESSAGE_KEYS` (its canonical order,
  which every projection iterates so compiled output is a function of content
  alone), `ValidationMessages` (the partial map schema), and
  `authoredMessageKeys(definition)` - the constraint keys a given question
  actually carries, which is what publish and an authoring editor both need.
- `PublishErrorCode` gains `ORPHAN_MESSAGE_KEY`: publish rejects a message keyed
  by a constraint the question does not carry, because such a message could never
  be shown. Default-locale completeness (invariant I3) now also covers the
  messages and the two boolean labels, so a message missing the form's
  `defaultLocale` is a reported publish error rather than a resolver throw.

`@roonga/qcms-a2ui-compiler` (minor: additive output for new content only). A question
carrying messages compiles them onto its control node as one optional `messages`
prop, resolved for the active locale, keys in canonical order. A boolean's two
displayed labels resolve the author's override else the `BOOLEAN_AFFIRMATION`
lexicon entry, **per label** - overriding "Yes" leaves "No" on the lexicon. The
prop is absent and the labels are unchanged when the author wrote nothing, so the
existing golden corpus is byte-identical; two new corpus entries are appended
(ADR-18 append-only) for the two features.

`@roonga/qcms-ui` (minor: new export, additive registry behavior). The vendored
`@a2ra/core` control props objects are `strict()` and `A2Renderer` validates every
node against its registry schema before rendering, so an unknown prop throws.
`withAuthorMessages(schema)` (plus `AuthorMessagesSchema`, `authorMessagesOf` and
the `AuthorMessages` type) is the qcms-side extension that accepts the ADR-32
`messages` prop while still validating the rest of the node against the vendored
schema unchanged, and the registry now wraps each question control with it. The
vendored components and their schemas are untouched (ADR-22).
