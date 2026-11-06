---
"@roonga/qcms-ui": minor
"create-qcms-app": minor
---

Make the Operations environment selector a dropdown, and give a menu row a second line.

- `@roonga/qcms-ui/kit` exports `MenuItemText`, the stack's own label and description slots
  for a menu row, so a row that names a known value keeps that value as its accessible name
  and carries its meaning in a description.
- The selector reads as what it is: a visible Environment label, a bordered trigger holding
  the environment chip, the word Change and a caret, and one radio row per configured
  environment naming it, saying what it is for and marking the current one.
- One `.qcms-envchip` now serves the bar, its menu and an assistant card, instead of two
  rules declaring the same chip differently.
