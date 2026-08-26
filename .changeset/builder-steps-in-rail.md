---
"qcms-admin": minor
---

Move the form builder's steps into the left rail, nested inside the Form row (Code Owner,
2026-08-25).

The builder used to carry its own step list as a card in the content column while the rail
beside it carried none: one screen with two step lists and no single place that owned them.
Every other form screen showed the steps in the rail, so the builder - the one screen where
a step can actually be worked on - was the exception. The steps are now in the rail on all
eight screens, and on the builder they are interactive: each row selects a step in the
editor, carries a Rename / Move up / Move down / Remove menu, and an add control sits under
the list. That is what `plan/admin-shell-poc/admin-shell-poc.html` has drawn all along.

They are also **nested inside the Form row** rather than stacked above the six sibling
routes, which is what the data model says: a form's steps belong to the form's own screen
rather than being a seventh peer of its sections. One tree, so no divider.

**Two §7 clauses are retired to allow it**, both by Code Owner ruling and both recorded in
`plan/admin-design-contracts.md`. "The rail never carries actions" had already been
overruled during the POC work - that document says so in its own preamble - and leaving it
written in the normative list while citing the preamble against it is what made it a source
of confusion rather than a rule. "Never carries same-page section switches" goes with it,
since a builder step row selects a step on the screen the reader is already standing on.
The section that used the second clause to argue the builder must have no steps is reversed
in place.

`lib/forms/builder-bridge.ts` is how the rail reaches the draft: the rail is a
parallel-route slot and therefore a different React tree from the builder, so the two share
a module store rather than props, exactly as the Settings rail does. The builder still owns
the draft, its history, its autosave and its validation; the rail calls a handler and the
builder decides what it means.

Before hydration, and for a reader with no JavaScript, the rail renders the same step
anchors the other seven screens show. The list gains behaviour on hydration rather than
appearing then.

Two things carried across from the retired list rather than left behind with it. The step's
anchor id moved with the steps: it is what `lib/forms/issues.ts` mints for the validation
panel's "jump to the offending step" links and what the other seven screens' rail rows point
at, so with nothing rendering it both sets of links landed nowhere. And Move up on the first
step and Move down on the last are greyed again; `moveStep` ignores an out-of-range move, so
leaving them live corrupted nothing but told a screen reader those commands were available.

`loadFormRail` loses its "siblings only" mode with the screen that asked for it. All eight
form screens now carry the same tree, so a switch for suppressing the steps could only
reintroduce the split this closes.
