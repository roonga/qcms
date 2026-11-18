---
"@roonga/qcms-ui": minor
"create-qcms-app": minor
---

Portal respondent menu and text size (task 120).

- `theme.css` sizes a root carrying a `text-scale-<n>` class at its `--text-base` ratio
  times the respondent's scale, capped at 32px; the font registry exports
  `LEGIBILITY_FONT_KEYS`.
- The portal's Appearance menu offers mode, face and text size (100, 125, 150, 200
  percent of the form's base). Density leaves the menu, and a density cookie is ignored.
- The face menu offers the legibility faces that `QCMS_PORTAL_FONTS` includes; System is
  always offered.
- The no-JS Appearance form saves only the axes the respondent changed.
- The completion page keeps the form's text size.
