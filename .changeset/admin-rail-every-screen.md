---
"create-qcms-app": patch
---

Give every authenticated admin screen a rail, and move the list filters into it
(`plan/admin-design-contracts.md` §7.0 rulings 1, 3, 4 and 6).

- Nine screens gain one through the existing frame: both library screens, their two creation
  screens, the responses index, the erasure log, webhook operations and the two membership
  screens. `app/(shell)/@rail/no-section.ts` has no caller left and stays for an exception
  that is not ruled today.
- The content column's left edge is the same on every screen, which is what the grid branch
  keyed on a rail being present could not give before.
- `components/rail-filters.tsx` is the Filters part: one `<form role="search">`, a visible
  "Filters" title, an active count, Apply and a clear link that shows only when a filter is
  set. The URL still carries the state.
- The filters leave the content column. The filtered-empty panels keep their own
  "Clear filters" beside the rail's, because contract §3 asks the panel to offer the way out
  where the reader is looking.
- Two filters are new and both are the ruled table's: a search over the responses index's
  way-in list, and a form filter over the dead-letter queue, applied to the rows the render
  read because the route is global.
- The back link is the rail Header's job on every screen, so the content-column links leave
  the two creation screens, the erasure log and the workspace detail screen.
- The question rail Header carries the live document's issue total as a client island; the
  rest of the rail stays server-rendered.
- A modified or non-primary click on a question panel row keeps the browser's default, so it
  opens a tab again.
