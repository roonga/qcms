# Gate 058 - the preview theme island

**What to approve:** that the preview box now wears a **respondent** theme while the QCMS
app around it keeps its own Cobalt look and your own light/dark/high-contrast choice, and
that both halves of every frame look right *together*.

The preview opens in whatever theme this deployment serves respondents (`QCMS_PORTAL_THEME`;
the frames below were captured with it set to Harbor). Two controls above the box let an
author look at the same question under any of the four themes and any of the three modes.
The choice is not remembered: every page load starts again at the deployment's theme in
light mode.

Each frame is a full page at **390px** and **1280px**, so you are looking at the pair - the
respondent surface inside the box and the authoring chrome around it - rather than at a crop
of the box.

| Frame | The island | The app around it |
| --- | --- | --- |
| `harbor-light` | Harbor, light (the configured default, untouched) | light |
| `plum-dark` | Plum, dark | light |
| `harbor-hc` | Harbor, high contrast | light |
| `sand-light-chrome-dark` | Sand, light | **dark** |
| `overlay-open` | Plum, dark, with a date picker's calendar open | light |

## One thing to look at deliberately: `overlay-open`

**Dropdowns and calendars open in the QCMS app's own colours, not in the theme being
previewed.** In the `overlay-open` frames the island is in Plum Dark and the calendar that
opens over it is Cobalt.

This is a known limitation and it is in the set so you can rule on it now rather than meet
it later. The reason is structural rather than a styling oversight: the component library
renders these floating panels at the very top of the page, outside the preview box, so the
box's theme cannot reach them. It affects the panel *only while it is open* - the field
itself, its label, its help text and the value you end up choosing are all inside the box
and are correctly themed.

It shows up in two places an author will meet: **every date question** (there is no way to
answer one without opening the calendar) and a **single-choice question with more than seven
options** (which the library renders as a dropdown).

Both available fixes were out of bounds for this task: one needs a new third-party
dependency, the other needs a change to the shared `@qcms/ui` package that this task is
explicitly fenced from making. If the appearance is not acceptable, that is a decision to
take one of them, and it belongs in its own task.

## What has not changed

Nothing outside the preview box. The topbar, the navigation, the cards, the tables and your
own appearance menu are exactly what they were, and switching the preview's theme does not
move any of them - which is asserted byte-for-byte by
`apps/admin/e2e/preview-theme-island.pw.ts`, not just photographed here.
