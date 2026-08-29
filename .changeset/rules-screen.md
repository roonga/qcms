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
