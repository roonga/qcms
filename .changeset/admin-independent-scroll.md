---
"qcms-admin": minor
---

Pin the rail so it scrolls independently of the screen beside it, with a scrollbar on
neither unless one is needed (Code Owner, 2026-08-24).

Above `--bp-sidebar` the rail takes the viewport's height below the top bar, scrolls its
own rows when it has more than fit, and stays where it is while a long screen is read to
the bottom. Its rows used to leave the screen with the page. The content column keeps
scrolling with the page, and below the boundary nothing changes: the rail is a band
stacked above the content there, so the two are one column in one scroll, which is what a
phone wants.

`overflow-y: auto` rather than `scroll` is the "only if required" half: a bar appears on
the rail only when its rows do not fit, where `scroll` would reserve gutter width on every
screen on a platform that draws permanent scrollbars.

**The content column is deliberately not its own scrollport**, and that was tried first.
`overflow` on `<main>` makes it a clipping box, and the row menu's popover is a DOM
descendant of it rather than a portal at the body - so "Remove option" was clipped by the
column exactly as it was once clipped by the option grid, and a press at its centre landed
on nothing. `apps/admin/e2e/questions-lifecycle.pw.ts` exists because of that earlier
defect and caught this one. Making the popover escape would mean changing where a shared
overlay primitive renders, which is a larger change than the scrolling it would serve.

The one number this depends on is `--admin-topbar-h`, the rail's sticky offset and its
height. It is derived - `calc(var(--admin-control-h) + 1rem + 1px)`, the bar being one
control tall plus its padding and its border - rather than measured off the bar and
written down, so it moves with the density token instead of going stale. A drift between
the two would show as the rail sliding under the bar or leaving a gap below it, and
neither is loud, so `e2e/rail.pw.ts` measures the bar against the resolved token.
