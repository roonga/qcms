---
"create-qcms-app": minor
---

Put the assistant on every authenticated admin screen, Settings included, with no floating
launcher and no float mode.

- A 32 CSS px button first in the top bar's trailing group, present only when
  `QCMS_FLAG_AGENT_AUTHORING` names a provider; with the flag off it is absent from the
  document rather than hidden. `Alt+Shift+A` opens or focuses the panel and is ignored
  while a page text input has focus.
- The panel is a third track of the shell body grid, so nothing it draws can cover page
  content (SC 2.4.11). Expand fills the area below the top bar as a modal dialog, and below
  `--bp-sidebar` the panel is a modal sheet. Whether it is open and how wide are a cookie
  the layout reads, so an open panel renders docked on the first paint.
- Between 1024 and 1279 CSS px opening the panel holds the sidebar hidden and writes no
  sidebar cookie, so closing it returns the operator's own setting; "Show sidebar" shows
  the rail, closes the panel and says so.
- The dock's edge is a focusable separator: arrow keys move the width by 40 px, Home and
  End go to the bounds, and the Help menu offers Narrow, Default and Wide for the same
  thing with single clicks (SC 2.5.7).
- One header on every screen: the title, a context chip naming what the assistant can see
  on that screen, New conversation, Expand, Help and Close. The form builder's panel
  renders as that header's conversation body.
- One conversation per form subtree, held in memory only: nothing about the conversation or
  the panel reaches `localStorage` or `sessionStorage`.
- A second BFF route, `POST /assist`, for screens with no form in their route, carrying the
  session gate and SEC-9's origin belt and answering 404 with the flag off.
- `GET /admin/forms/{id}` answers `canWriteDraft`, the caller's own `form: write` on that
  form in the request's environment. The builder reads it to decide whether its assistant
  may propose, in place of the deprecated `workflow.canEdit`.
