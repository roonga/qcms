---
"qcms-admin": minor
"create-qcms-app": patch
---

Give every authenticated admin screen a rail, and move the list filters into it
(`plan/admin-design-contracts.md` §7.0 rulings 1, 3, 4 and 6, Code Owner 2026-10-24;
issue #1117).

Nine screens had no rail: both library screens, their two creation screens, the responses
index, the erasure log, webhook operations and the two membership screens. Each had a slot
page returning `null`, and `plan/admin-ux-audit.md` §5.4 was the reason - a rail there would
either be empty or would repeat the page's own body, "and now there are two of them and they
can disagree". §7.0 ruling 1 reverses that: every screen has a rail by default, and a screen
goes without one only by a per-screen ruling recorded in §7.0's table. None is ruled, ruling
6 names New form specifically as not an exception, and `app/(shell)/@rail/no-section.ts` now
has no caller at all. `lib/rail-routes.test.ts` is the gate that keeps it that way, from both
directions: a screen with no slot page fails there, and so does one that quietly starts
exporting the stub again.

**The content column starts in the same place on every screen.** That is the acceptance
criterion the issue states first and the one a reader notices without being able to name it:
the grid only grows its 240px track when a rail is in the slot, so a screen without one put
its table 240px further left. `e2e/rail-every-screen.pw.ts` measures the column's left edge
on all eleven screens at 1440 and asserts there is one value, rather than asserting a rail is
in the DOM - which would pass on a rail that renders with no width.

**The list filters live in the rail's Filters part.** One component rather than four
toolbars: `components/rail-filters.tsx` is the `<form role="search">`, the visible "Filters"
title, the active count, Apply and the clear link, and each screen hands it its own controls
in the ruled order (Search, status, type or other, then sort). Everything the toolbars were
is unchanged one column to the left - a native GET submission, the URL carrying the state, a
filtered list that bookmarks and reloads - and `questions.filter.legend`,
`questions.filter.apply`, `forms.filter.legend` and `forms.filter.apply` went with the move,
along with the two per-screen clear links. "Filters" is a visible title rather than a heading
element because the rail renders before `<main>`, so a heading in it would be a
`heading-order` violation on every railed screen at once.

**The filtered-empty panels no longer offer "Clear filters".** They used to carry it as their
call to action, and the rail's link would have made two controls with one accessible name on
one screen - which is the ambiguity §3's rule was avoiding, and which the browser suite has
already caught once on the question library. The way out of a filter is where the filter is.

**Two filters that did not exist are the ruled table's, and both are small.** The responses
index gains a search over the forms in its way-in list, which is `GET /admin/forms`'s own
`search` parameter. Webhook operations gains a form filter, which narrows the dead-letter
queue THIS RENDER READ rather than asking the API for a capability it does not have: the
route is global by design, because "is anything stuck" is a question about the deployment.
`listAllForms` and `listWorkspaces` are memoized per request so the three screens whose rail
and page need the same list still cost one round trip, which is the duplication
`lib/server/request-reads.test.ts` exists to hold down.

**The way back is the Header's back link on every screen** (ruling 3), so the content-column
links left `/questions/new`, `/forms/new`, the erasure log and the workspace detail screen,
and `questions.backToList`, `forms.backToList`, `ops.erasures.back` and
`membership.workspace.back` left the catalog with them.

**The question rail's Header carries the live document's issue total**, which #1116 left out
and the Code Owner ruled into this issue: the number comes from the editor's live document
through `lib/questions/editor-bridge.ts`, so it is a client island in the frame's `count`
slot and the rest of the rail stays server-rendered. It shows nothing before hydration and
nothing at zero, and it clears on a save the API accepts. The frame's `count` became a slot
rather than a string to allow that, with `RailCount` as the one place the badge is written.

**A modified click on a question panel row opens a tab again.** The handler that switches the
panel called `preventDefault` unconditionally, so Ctrl, Cmd or Shift with a click switched the
panel in place while the Settings rail's rows opened a tab - two kinds of row in one rail,
which is what ruling 2.2 exists to prevent. The handler now stands down for a modifier or a
non-primary button and lets the browser's default apply.
