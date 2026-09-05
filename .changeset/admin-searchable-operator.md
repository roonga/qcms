---
"qcms-admin": minor
---

The rule editor's Operator picker is searchable (Code Owner, 2026-08-30).

A `Select` is a list you scan, which is right for a handful of choices and wrong once the list
is longer than its popover. The operator list is thirteen entries whose names are phrases
("includes any of", "is at least"), and it is a list an author arrives at already knowing
roughly what they want. `components/searchable-select.tsx` is that control, composed from the
`ComboBox` primitives `@roonga/qcms-ui/kit` now exports.

The APG combobox pattern rather than a filter box above a `Select`: it carries the
input-to-listbox relationship, the roving `aria-activedescendant`, the "N results available"
announcement and the type-to-filter behaviour. A text field above a list looks the same and
announces nothing.

`disabledKeys` still marks the operators a question's type does not accept rather than hiding
them, which is what keeps "that exists, but not here" readable. Filtering is about finding;
disabling is about legality.
