---
"create-qcms-app": minor
---

The admin shell keeps one top bar and one rail per area, with a rail toggle and a breadcrumb on every screen.

- The top bar has one layout everywhere: the application navigation stays inside Operations, and the Exit and environment slots keep their size elsewhere, so switching areas moves nothing.
- Questions, Forms, Operations and Workspaces each keep one rail tree with no back link and no title repeating the page heading. Inside one form or question the rail links to all of them and names the item.
- An icon button at the top bar's start, or `Alt+Shift+S`, collapses the rail to a narrow strip; the choice is remembered per viewer. It replaces Hide sidebar and Show sidebar.
- A breadcrumb row heads every screen.
- Exit Operations refuses a remembered address carrying control characters or resolving to another origin.
