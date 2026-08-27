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
