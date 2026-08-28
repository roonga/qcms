---
"qcms-admin": minor
---

The builder's header is two rows instead of five (Code Owner, 2026-08-26).

It was a heading, three lines of description, a gap and then a button row, before any of the
form's own fields. It is the heading's row - taking the publish controls and the save state
with it - and one muted line under it. Measured at 1280: the block is 80px tall where it
was roughly 200px, and nothing was hidden to get there.

**The builder names its screen, not its form, which reverses issue 679's exemption for this
one route.** 679 exempted it on the reasoning that "the `<h1>` names the page's subject, and
on the builder the subject IS the form". That was true of one screen; the builder is two
now, and its step screen already heads itself with the step. So the premise expired, and
the slug it kept was being repeated from the breadcrumb directly above and from the rail
beside it. `app/(shell)/section-headings.test.tsx` records the reversal and keeps the part
that still holds: this route composes its own header rather than rendering `FormPageHeader`,
and a later pass at consistency routing it through the shared one would quietly take the
publish controls and the save state with it.

**One name in three places.** The last crumb read "Builder" while the rail's row read "Form
details" - one screen answering to two names, introduced when the row was renamed. All
three now read from `forms.tab.builder`, and the test asserts it. `forms.builder.heading` is
deleted rather than left unused.

The description is one line of bare values - id, locale, status, draft origin - where it was
three labelled ones. An id looks like an id and a status is a word; the labels were chrome
around facts an author reads once.

**The heading is no longer painted where it only repeats the breadcrumb.** "Form details"
sat directly under "Forms / kitchen-sink / Form details", and "Links" under
"Forms / kitchen-sink / Links". Every screen still HAS its level-one heading - it is what a
screen reader navigates by, and a page without one fails the axe sweep this app runs in
three modes - but the default one is clipped to a 1x1 box rather than drawn. Measured: the
`<h1>` is 1x1 on both the builder and Links, and exactly one heading of level 1 still
resolves in the accessibility tree on each.

A route that passes its OWN heading keeps it visible: the version detail's "Version 3" and
the response detail's heading name something the breadcrumb does not, and that is also the
branch that takes focus programmatically - a focus destination nobody can see would be a
worse thing to have than a repeated title.

Three corrections found in use.

**The buttons no longer sit indented past the breadcrumb.** The visually hidden heading is
out of flow, but the wrapper it needs - a server-rendered node bare in a multi-child array
reads to React as a keyless list item - was an empty flex ITEM, and the row's `gap-x-4`
after it pushed the actions 16px right. `display: contents` keeps the element and removes
its box. Measured: the breadcrumb and the Publish button both start at x=264.

**What the form is now sits above how it last saved,** sharing the row's trailing edge:
both are facts about the form rather than actions on it, so they read as one block instead
of chrome scattered across the header.

**Pressing the "?" no longer moves the page.** The sentence was in flow, so it added a line
to that column and everything below the header moved down as the control was pressed - a
layout shift caused by asking what a control does. It renders over the screen now. Absolute
positioning is safe here in a way it was not for the row menu this app once had clipped:
`<main>` is deliberately not a scrollport, so nothing between it and the viewport has
`overflow` to clip against. Measured across a press: the "Form title" label held y=349 and
the button held x=1236, y=150.
