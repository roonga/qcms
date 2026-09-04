---
"@roonga/qcms-ui": minor
---

Export the react-aria `ComboBox` primitives from `@roonga/qcms-ui/kit`.

The pinned a2-react-aria registry ships a `select` and no combobox, so there is nothing to
vendor, and ADR-22 names the alternative outright: a host uses the vendored components or
react-aria-components. These are re-exported unstyled, exactly as the menu and tab primitives
already are, so a host that needs the APG combobox pattern gets its keyboard contract and its
roles from the stack's own foundation instead of hand-rolling them.

Aliased (`ComboBoxInput`, `ComboBoxListBox`, `ComboBoxOption`, ...) because the bare
react-aria names are generic and would collide with the vendored components and the menu
primitives. Nothing else in the package changes.
