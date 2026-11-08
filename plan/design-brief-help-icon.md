# Design brief: help icon and help text

## Problem

The "?" that opens a short help text looks unfinished and is drawn wrong in places.

- The icon is a 1.125rem outlined circle with a literal `?` at 11px, muted text on a strong border. In the Questions editor it renders as a tall oval beside the field and looks like a stray control.
- It does not read as help at a glance, has no hover or pressed state, and no visible keyboard focus beyond the browser default.
- The help text is a plain bordered box with 13px text. It has no pointer to its icon, no title or "learn more" pattern, no rule for length, and no placement rule beyond "below, clamped to the viewport".
- 41 uses across the admin shell, in field labels, section headers and rails. Most are one short sentence.

## Ask

Design the help icon and the help text as one pattern, for the admin app only.

## Decisions needed

1. **Icon:** shape, size, glyph (`?`, `i`, or a drawn mark), stroke or filled, and how it sits on a label line and in a table header without changing line height.
2. **States:** default, hover, keyboard focus, pressed or open, disabled (if it can be), and in all four themes (light, dark, hc, hc-dark).
3. **Hit area:** visible size versus touch target (at least 24px for WCAG 2.5.8, 44px preferred on phone) without enlarging the row.
4. **Text popover:** surface, border, radius, shadow, width (current max 18rem), pointer or arrow to the icon, motion (current 120ms fade).
5. **Placement:** below by default, flip above near the bottom, clamp to the viewport on phone, never widen the document.
6. **Content rules:** maximum length (one to two sentences), whether a heading is allowed, whether a link such as "Learn more" is allowed and how it is reached by keyboard, how a longer text overflows.
7. **Behaviour:** opens on hover, focus and tap, closes on Escape and blur; say whether it stays open while the pointer is over the popover (WCAG 1.4.13 dismissible, hoverable, persistent).
8. **Tone of the text:** a short style rule for writing help (sentence case, no restating the label, say the rule or the format, not the feature).

## Constraints

- Admin only. Colour is reserved for environments, so help must be neutral, not tinted.
- Accessible name contains visible text (the glyph), `role="tooltip"` with `aria-describedby`, `aria-expanded` on the button; screen reader reads the text on focus.
- Works inside the rail, the top bar, side sheets, table headers and forms, in a left-to-right layout.
- Phone width and all four themes. No layout shift when it opens.
- Selected-row and current-state styles stay as in the design system; help does not reuse the accent edge.

## Deliver

- The icon in every state and theme, at the label size and at a table header size, on a desktop and a phone field.
- The popover with a short text, a two-line text, a text with a link, and one near the right and bottom edges.
- A ruling on each decision above, and the writing rule for help text.
- Update the QCMS design system artifact in the same pass (a Help card with the icon, popover, states and the writing rule).

## Current implementation (for reference)

- `apps/admin/components/help-tip.tsx` (`HelpTip`, `FieldHelp`), styles `.qcms-helptip*` and `.qcms-field-help` in `apps/admin/app/globals.css`.
- Accessible label from `t("help.label")`.
