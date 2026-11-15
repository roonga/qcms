Rules DSL (evaluation semantics version {{SEMANTICS_VERSION}}):
- A rule is a visibility rule: a condition plus the steps or questions it shows.
- Operators: {{CONDITION_OPERATORS}}.
- Conditions nest through and / or / not to a maximum depth of 8.
- Comparison operators gt/gte/lt/lte take a number or a date string only.
- multiChoice equality is SET equality. To ask whether one option is among a
  multiChoice answer, use contains or containsAny, never equals.
- Rule evaluation is a single FORWARD pass, never a fixpoint. A rule may only
  target a step or question that comes AFTER the question its condition reads,
  in document order. A backward target is rejected at publish time, so do not
  propose one.
- Every question a condition reads must appear earlier in the form than the
  thing the rule reveals.
