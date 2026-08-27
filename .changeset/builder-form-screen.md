---
"qcms-admin": minor
---

The form builder becomes two screens behind one route: the form's own details, and one
step (Code Owner, 2026-08-26).

The form's title, settings, rules, rule test bench and validation are properties of the
FORM, and they were stacked under whichever step was selected. Nothing was duplicated in
the DOM, but the arrangement said the wrong thing: five form-level panels followed the
reader from step to step as though each step carried its own copy of them, and the only
way to reach the form's settings was through a step that has nothing to do with them.

`plan/admin-shell-poc/admin-shell-poc.html` has drawn the answer since the shell work
began, and says so in its own card subtitle: "left rail navigating a form screen and a
step screen". It ships a Form row above the steps, carrying `aria-current="page"`, and a
Form screen of exactly those five panels beside a Step screen of that step's questions
alone. This builds what it drew.

**The rail is the switch, and it is the only one.** A new Form details row sits above the
Steps group and outside it, because the form is the sibling of the whole list rather than
one of its members. Like a step row it is a button, not a link: this route is already the
one the reader is standing on, so choosing it changes the column beside the rail rather
than navigating (`docs/admin-constraints.md`, an anchor navigates and a button acts).

The builder opens on the form, which is what the drawing has current, and it is the honest
landing for a screen whose rail now lists the steps: the reader picks the one they came
for instead of being dropped into whichever happens to be first. Removing the selected
step returns to the form rather than guessing at a neighbour.

Two rail changes ride along, both Code Owner calls on the same day. **Naming a new step
moved into a dialog**: the field used to stand open under the step list whether or not
anyone was adding a step, which is a permanent empty text input inside a navigation
control. It is the shape Rename already used, for the reason given there - the rail track
is 240px, and a field inside it is narrower than most step titles. **The current step no
longer paints an accent edge**: the ordinal already sits at the start of the row, so the
edge read as a second, competing marker. The section rows above keep theirs, having no
ordinal. This does not leave colour carrying the state alone - `aria-current="page"` is
still what a screen reader is told, and the heavier weight still survives high contrast.

`app/(shell)/form-read-states.test.tsx` renders `StepEditor` directly for its pin-grid
assertions now, and says why: a static render of the page reaches the form screen, and the
switch that would leave it lives in the `@rail` slot, a different React tree that render
does not include. The page half is still asserted through what the page itself emits.

**The Builder row IS the Form details row** (Code Owner, 2026-08-26). The first cut added a
second, nested row for the form's details, which put "Form details" directly beneath
"Builder" with both marked current: two rows, one meaning, and no way to tell which was
which. There is one row now. It is renamed from "Builder" to "Form details", because that
is the screen it opens, and on the builder itself it is a button that selects that screen
rather than a link to where the reader already is. The row still earns its place - it is
how the other seven form screens get back here - and the builder route's own `<h1>` is the
bare slug (issue 679), so nothing else on the screen moves with the name.

**The current row no longer paints an accent edge** anywhere in this rail. Three things
were marking the same place at once: the row for the screen, the row for what that screen
is showing, and a step's own ordinal. Scoped by `[data-rail-group]`, which only this rail
emits, so the settings and question rails keep theirs - they are flat lists of one kind of
row, with nothing competing. Colour is still not carrying the state alone: `aria-current`
is unchanged and the heavier weight survives high contrast.

**Publish and close/reopen moved onto the form screen**, which is what they act on. They
publish the form and close the form, and standing them above a column that is usually
showing one step said they were about the step. `FormActions` stays a server component
holding its own bound actions, handed to the builder as a node.

That move had a catch worth naming. A refused publish renders an anchored work list whose
links move focus to the rule, step or pin at fault - it is why those controls sat above the
builder in the first place. A rule is on the form screen and a step's anchor is in the rail,
but a PIN is rendered by one step's editor, so from the form screen that link pointed at an
element that exists in the draft and not in the document, and the old handler returned
silently. `IssueEntry` now selects the owning step first and then focuses.

The node crossing that boundary is wrapped in an element rather than dropped straight into
the fragment, and the wrapper is load-bearing: a server-rendered element loses the marking
React uses to tell a statically-written child from a dynamic one, so as a bare member of a
children array it reads as a keyless list item and logs a key warning on every visit. Twelve
browser tests failed on that console error before it was wrapped, which is the gate working.

**The three standing notices say themselves once, on the form screen** (Code Owner,
2026-08-26): the draft was seeded, the form is closed, another author may have it open.
They used to stand above the whole builder, so every step screen repeated all three above
that step's questions - none of them about the step, and none of them changing while the
reader works.

Autosave-paused and save-failed deliberately did NOT move with them. Those two are about
the save happening right now, and the work at risk when they appear is usually the step
being edited, so hiding "this draft is not being saved" behind a screen switch would hide
it exactly when it matters. They stay above the split, on every screen, and cost the step
screen nothing when quiet.

Two corrections found in use. **An empty notice block was holding a gap open**: the save
notices render into the builder's `gap-6` column, and a wrapper with zero height still
consumes a whole gap slot, so the step screen sat 48px below the breadcrumb where 24px was
intended. It renders nothing at all now when it has nothing to say.

**The rail no longer collapses above `--bp-sidebar`** (Code Owner, 2026-08-26). At that
width the rail is a permanent sidebar and the stylesheet already hides the chevron and sets
`cursor: default`, but the `<summary>` stayed live - so clicking the form's name folded the
whole rail away with no visible affordance to bring it back. The summary's own click is
refused there, which covers the keyboard too, since Enter and Space on a summary dispatch a
click. `pointer-events: none` would have stopped the mouse and left the keyboard with the
problem. Below the boundary it is a disclosure exactly as before: shut by default, opening
on a press.

**Add step is on all eight form screens, and it is quieter** (Code Owner, 2026-08-26). Off
the builder it is an anchor rather than a button, because off the builder it navigates:
there is no draft in that tree to add a step to, so it goes to the builder carrying
`#new-step` and the builder opens the dialog on arrival. A fragment rather than a query
parameter, because it asks the browser what to do on arrival rather than naming a different
resource, and it never reaches the server. It is cleared once read, so a reload or a press
of Back does not reopen a dialog the reader has dismissed.

The button's variant moves from `secondary` to `ghost`, which is a naming trap rather than
a change of mind: the kit's `secondary` is a solid slate fill with white text, so in a rail
of quiet rows it read as the loudest thing on screen and as the primary action of the whole
builder. `ghost` is the kit's outlined treatment, which is what a secondary action looks
like here. The dialog keeps `primary` on its confirm, where adding the step really is the
primary action.

`interactiveSteps` is gone with this. Every form slot page now renders the same rail the
same way, and interactivity comes from whether a builder has published to the bridge - only
the builder mounts one, so what the flag asserted is true by construction instead of by
agreement. `lib/rail-routes.test.ts` pins the replacement property.
