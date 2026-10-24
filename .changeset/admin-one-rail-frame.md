---
"qcms-admin": minor
---

Build the one rail frame and move the form, question and Settings rails onto it
(`plan/admin-design-contracts.md` §7.0, Code Owner 2026-10-24; issue #1116).

Three rails looked alike and behaved differently. The form subtree's navigated between
routes, Settings' switched which panel of one route was showing, and the question detail's
did both and carried its lifecycle actions as well. Each was a separate component with a
separate contract, and `components/rail-frame.tsx` deliberately held only the four things
§7a said they shared, so that no later reader could "unify" them. The 2026-10-24 ruling
unifies them: one rail, belonging to the page rather than to the app, that looks and behaves
the same everywhere.

**The frame is the anatomy now.** Five parts, always in this order: Header, Sections,
Children, Filters, Actions. The root is an `<aside>` named for its subject - a form's name, a
question's id, "Settings" - and the Sections sit in a `<nav>` named "<subject> sections",
which replaces three per-rail landmark strings. The single native `<details>` stays, for the
reasons it always had: an element cannot be chosen by media query, and a second copy of a
navigation is a second set of links to walk. Filters and Children are declared and unfilled,
because the order is the contract and a part added later in the wrong place is how an anatomy
stops being one; #1117 and #1118 fill them.

**The Header is the way back.** A back link to the parent screen, the subject's name and at
most one status tag; below `--bp-sidebar` the name line is the summary and carries at most one
count, with the link above it so it survives the collapse. That replaces the content-column
breadcrumb on every form screen, and the form rail stops hiding its own summary above the
boundary - §7.0's Header carries a link and a tag that no row has, so the line is no longer
the form's name said twice. The default section heading became visible with the breadcrumb's
removal, because it is now the only thing naming those five screens in their own column, and
`FormPageHeader` no longer takes the form's slug at all.

**One current-row mark.** A tinted fill, weight 700 and a 2px inline-start accent edge, and a
PARENT of the current row gets weight 600 and no fill, so exactly one row reads as selected.
That was three rules: the form rail dropped the edge from every row of its tree because the
mark stacked up three deep, the Settings rail restated the four declarations under a class of
its own, and the question rail painted a version row and its open panel identically one above
the other. It is one rule and one `:has()`, which is what makes "exactly one row" checkable.

**Rail rows are anchors, never buttons.** The Settings rows link to the three section ids the
account menu has published since task 032, and `components/settings-panels.tsx` listens for
the fragment, so the rail and that link travel one channel rather than two. A question panel
row links to the panel's own section id - the same id the editor puts on the open panel and
the same id a refused save moves focus to - while `?panel=` stays the address a reload reads.
The admin requires JavaScript (standing correction 2026-08-22, ruling 2026-09-27), so the
click is the whole mechanism rather than an enhancement over one.

**Lifecycle actions leave the rail.** Publish and Deprecate are in the question screen's one
heading row beside Save, which is where every other screen in the app keeps a consequential
action; New version stays in the rail as a structural action, and the form rail's Add step
moves from the step cluster into the Actions part. The POC's reason for pinning the lifecycle
block above the version list - that the list grows without bound, so an action beneath it
drifts - is answered rather than overruled: the one control left in the rail is offered
whatever the selected version's status, so it never moves.
