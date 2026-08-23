---
"qcms-admin": minor
---

Fix three defects the Code Owner reported against the running dev stack, all of them about
the left rail. The topbar keeps the primary navigation and the rail stays what it was: the
context of the ten screens that have one.

**A rail followed the reader onto screens it said nothing about** (#701, and #633 before
it). Walking from Settings to any other screen left the Settings rail standing beside a
table it did not describe. `app/(shell)/@rail/default.tsx` claimed in its own docblock to
prevent this and could not: Next keeps the previously active state of an unmatched slot
across a soft navigation and consults `default.js` only after a full-page load. Every route
now has a page in the slot, and the seven screens with no rail have one that returns `null`,
which is a different thing from having no page at all. `lib/rail-routes.test.ts` compares
both route trees off the filesystem so a screen added without one fails there, and the
browser spec asserts the walk by CLICKING, because `page.goto` is a hard load and passes
against the bug.

Measured against the shipped build, the rail went stale walking to all four destinations,
including the two with no directory under `@rail`, so #701's predicted cause was wrong and
the per-directory `default.tsx` it suggested would not have fixed it.

**The rail stopped short of the bottom of the screen.** A `Signed in as ...` footer spanned
both tracks below it, so the rail's surface and border ended a footer's height above the
viewport's bottom edge on every screen that had a rail. The footer is gone; the account menu
in the topbar already carries the same email on every screen, including the seven with no
rail, which is why the line was not moved into the rail instead (Code Owner decision,
2026-08-23).

**The form rail's collapsed summary named the selected item** (#693) where the other two
rails name their scope. It named a step label, a section label, or the form's slug only when
neither was current, so one line meant three things; and since #692 it read as the first
half of the `<h1>` directly below it. It names the form at every position now, which is what
`plan/admin-shell-poc/admin-shell-poc.html` draws, and the badge beside it is the form's
issue total rather than the current row's count.

One change that is not a fix: **below `--bp-sidebar` the rail now opens shut** (Code Owner
decision, 2026-08-23), so a narrow viewport meets one summary line rather than a rail pushing
the screen's own content down. `open` is an attribute and no media query sets one, so
`components/rail-disclosure.tsx` decides it in the browser and says why that is preferable to
forcing `::details-content` visible: an always-shut element with visible rows announces
"collapsed" to a screen reader while its links sit in the tab order. The first HTML is still
`open`, which is what a reader with no JavaScript keeps, and a stylesheet rule hides the body
below the boundary for the frame before hydration so a phone never paints an expanded rail.

No route's cap in `lib/measure.ts` changes, and no screen gains or loses a rail.
