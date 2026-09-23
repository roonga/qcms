---
"@roonga/qcms-ui": minor
---

Make a number question answerable and a required multi-choice group passable with
scripting disabled (issues #18 and #974).

The controlled render is unchanged in both cases, and every vendored file stays
byte-identical to upstream (ADR-22).

**The number question renders a native input in native-submit mode.** react-aria's
NumberField splits one question across two elements: the box the respondent types into is
`<input type="text" inputmode="numeric">` with no `name` at all, and the form value rides
a separate `<input type="hidden">` that only JavaScript writes. So with scripting off,
typing a number filled the visible box, left the named field empty, and satisfied the
browser's own `required` check - the step submitted with the answer discarded and nothing
saying so. Native-submit mode now renders `NativeNumberField`, qcms-owned markup around a
real `<input type="number">` carrying the question's label, description, error slot and
its compiled `minValue` / `maxValue` / `step` as `min` / `max` / `step`, posted under the
question's own name with the same `number` kind tag. A question that admits fractions
renders `step="any"`, because HTML's default for an omitted `step` is `1` and would refuse
them. `input[type="number"]` was already in the tabular-figures and text-entry-control
selectors in `theme-components.css`, so the fallback's digits and box need no new rule.

**A required multi-choice group renders without the native `required` attribute.** HTML
has no "at least one of these" constraint, and react-aria encodes the rule by putting
`required` on EVERY checkbox and taking it off on the re-render that follows the first
selection - which needs scripting, so a server-rendered page froze the attribute on all of
them and the browser demanded every box be checked. The step was impassable. In
native-submit mode the adapter now provides react-aria's own `FormContext` for that
group's subtree alone, with `validationBehavior: "aria"`, so the boxes carry
`aria-required` instead: the group still marks itself required in its label, in
`data-required` and to assistive technology, nothing blocks the submit, and the API's
missing-required report carries the constraint after the round trip. The scope is one
group, so every other control on the step keeps validating natively.

Both follow one principle (Code Owner ruling, 2026-09-19): JavaScript is assumed, and the
no-JS form is a fallback that must work functionally, without rapid feedback.
