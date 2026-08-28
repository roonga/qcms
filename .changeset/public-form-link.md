---
"qcms-admin": minor
---

A published form shows its public address on the form details screen (Code Owner,
2026-08-26).

`${QCMS_PORTAL_BASE_URL}/f/<slug>` is the portal's anonymous entry route
(`apps/portal/app/f/[formSlug]/page.tsx`), and it is the form's own standing address for as
long as it stays published: it never expires and it is never consumed.
`plan/admin-shell-poc/responses-poc.html` draws this block - the label, the `<code>`, the
Copy button and the hint are all from that drawing - and is emphatic that it is
**deliberately separate from a minted secure link** on the Links screen, which is a one-time
or expiring invitation the API cannot show a second time. The POC puts it on the Responses
screen and says so "rather than only on the Form/Links tabs"; this is the Form one.

**No link is shown rather than a broken one.** A form with no published version gets
nothing: the portal's start route answers `notfound` for it, and an address an operator
would hand out before discovering it does not work is worse than silence. A CLOSED form
does keep its link - the address is live and correct, the portal answers it with "this form
is closed" - and the hint beside it says which of the two states the form is in.

The admin becomes the third reader of `QCMS_PORTAL_BASE_URL`, and the only one for which it
is optional: the API requires it to mint secure links and the portal requires it for its
start redirect, while here an unset value costs one block on one screen rather than a
working request. This app makes no request to the portal with it; it writes the address
down. `scripts/dev-stack.mjs` and the admin's Compose service now pass it, and
`docs/operations.md` documents it - `scripts/env-reference.test.ts` failed until it did,
and `scripts/dev-stack.test.ts` failed until the admin's whole env list was restated, which
is what keeps "this service's configuration is small enough to read" honest.

The base is treated as an ORIGIN, so a path on it is dropped. That matches how the API
mints every secure link, and `lib/forms/public-link.test.ts` writes the limitation down
rather than leaving the assertion looking like a bug: a portal under a sub-path would get a
wrong address from both, and fixing one only would be worse - two surfaces handing out two
different links for one form.

The address is a link that opens in a new tab, not just a string to copy: following it is
how an author checks that what they published is what they meant. A new tab because the
author is mid-edit on a draft this screen autosaves, and taking the tab away would cost
them their place; `rel="noopener noreferrer"` because a `_blank` link without it hands the
opened page a handle on this one. A visually hidden "(opens in a new tab)" says so to a
screen reader.

Copy is the icon button the pin grid already uses for copying an id, down to the class and
the two shapes: one gesture, one shape, one set of styles. A bare `<button>` rather than
the kit's, because the kit's takes no `aria-label` and an icon button needs one.

`scripts/dev-stack.mjs` now honours a pinned `QCMS_INTERNAL_TOKEN` instead of always
minting one, which is the same shape `QCMS_ADMIN_AUTH_SECRET` already had there. Issue
#281's note that "nothing outside this process can learn the token" described the default
rather than a security boundary; this is a development launcher and the alternative was
reading the token out of the running API's `/proc/<pid>/environ`. What it buys is a second
frontend against the same API and database, so an author checking a published form's public
link has a portal to open it in.

Copy turns into a tick when it succeeds, and back after two seconds. Feedback about a
gesture rather than a state the control is in: a button that stayed ticked would say "this
link is on the clipboard", which stops being true as soon as anything else copies anything.
It does NOT tick on a refusal - a tick would say the address was copied when it was not -
and the accessible name stays "Copy" throughout, because pressing it still copies and
renaming a focused control under a screen reader mid-interaction is the worse trade. The
live region beside it is what says the copy happened. Colour is the echo, not the message:
the shape changes.

The paragraph explaining what this address is - and what it is not - sits behind a "?"
beside the heading rather than under every published form. It never changes, so it was
four permanent lines saying one standing thing.

A disclosure, not a tooltip: what it holds is a paragraph, which is too long to hover over
and is exactly what a keyboard or touch reader loses when it is a tooltip. `aria-expanded`
and `aria-controls` say which it is, and the dot fills when open so the state is not
carried by the attribute alone. It renders in flow rather than floated over the column,
because an absolutely positioned panel inside a scrolling column is what produced the
clipped row-menu popover this app has already fixed once, and nothing here needs to
overlap anything. Measured: the block is 98px closed and 146px open.

The label, the address and the two controls that act on it are one row rather than three
stacked ones: it is a single fact, and a label above its value made the block read as a
section rather than as a field. `flex-wrap` keeps that honest at a narrow width, where the
address takes the second line rather than being truncated.
