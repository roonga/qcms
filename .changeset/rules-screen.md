---
"qcms-admin": minor
---

The form's rules get a screen of their own (Code Owner, 2026-08-26).

`plan/admin-shell-poc/rules-screen-poc.html` has drawn this all along - a full-width rule
editor, headed "Rules", with its own row in the rail. The form's details screen was carrying
the title, the rules, the validation panel, the settings and the test bench at once, and the
rules are the largest thing on it: a condition editor is the widest thing this app builds.

**It is a selection, not a route, and that distinction is the whole of it.**
`plan/admin-ux-audit.md` §5.5 refused the POC as drawn, and was right to:

> Move Validation to its own route and every one of those anchors resolves to nothing. The
> same list is reused verbatim for a refused publish, so the regression hits the publish
> flow too... Rules can move if rule-scoped issues get a two-hop path, which is a real
> degradation to accept knowingly rather than discover.

The builder is three screens behind one route now, so a validation entry that names a rule
switches to the rules screen and then focuses it - exactly as it already switches to the
step that holds a pin. The degradation the audit told us to accept knowingly was the cost of
a route split; there is no route split, so it is not paid. `lib/forms/issues.ts` gains
`anchorIsOnRulesScreen` as the companion to `stepOwningAnchor`, and the publish rejection
list gets the same behaviour for free, because it renders the same entries.

**Validation stays on the form's screen**, which is the one thing §5.5 is firm about:
"Validation is not a destination. It is a companion to editing." Its entries now point at
three different screens, so what makes them work is the switching rather than adjacency.
Settings and the test bench stay too - the audit says they could move, and moving them was
not asked for.

Landing on `/forms/{id}#rule-{ruleId}` selects the rules screen, the same way a step
fragment already selects its step.

Two corrections found in use.

**The Rules row is on all eight form screens.** Rendered only on the builder, it made every
section row below it sit 40px higher on the other seven, so walking between Preview and the
form moved the whole lower half of the rail - the same defect the step rows were fixed for,
reintroduced by a new row. Off the builder it is an anchor carrying `#rules`, because there
is no draft in that tree to select in, and the builder selects the rules on arrival. Measured:
every row of a builder rail and a Preview rail now at matching y and heights, sections at
327, 369, 411, 453 and 495 on both.

**It spans the row it sits in.** It borrowed `qcms-rail-steps__form`, which is a flex ITEM
sized by the row it shares with a menu trigger, so standing alone it shrank to the width of
its own text - 57px of highlight on a 223px row, visible the moment it was the current one.
It has its own class and owns the full width: measured at x=8, w=223, the same box as the
section rows above it.
