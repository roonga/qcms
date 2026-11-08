# Design brief: one Operations toolbar

## Problem

In Operations mode the admin top bar shows three pieces that repeat each other:

- an "Operations" nav tab (the area title)
- an "Exit Operations" button
- the environment trigger, "Environment [PROD] ⌄", in its own bordered box

"Operations" appears twice, and the three controls read as unrelated.

## Ask

Design one united toolbar for Operations mode that holds area title, exit and environment, with "Operations" shown once.

## Constraints

- Admin only. Applies to the sticky top bar (`.qcms-topbar`) on desktop and phone widths.
- Exit keeps the leave-Operations warning and the Exit return behaviour.
- Environment trigger stays a dropdown. Its accessible name must contain its visible text (WCAG 2.5.3), now "Environment <env>" with no "Change" word.
- Production must stay visually unmistakable (chip colour), including in the high-contrast themes.
- Outside Operations the bar is unchanged.

## Proposal to react to

- One grouped bar: `Operations` title, then `Exit`, then a divider, then `Environment [PROD] ⌄`.
- "Exit" visible text, accessible name "Exit Operations" for screen readers.
- No separate bordered box for the environment trigger.

## Deliver

- Desktop and phone mockups, all four themes (light, dark, hc, hc-dark), PROD and non-PROD.
- Ruling on Exit placement (before or after the environment control) and divider style.
- Update the QCMS design system artifact in the same pass.
