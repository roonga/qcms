---
"qcms-admin": patch
---

Name the topbar's account button with the initials it paints (issue #1010).

The disc showed a monogram and the button answered to "Account menu for
dev@qcms.test", and for the account every documented deployment starts with,
those two strings had no character in common: `pnpm qcms:create-admin` names an account
`Administrator` when `QCMS_ADMIN_NAME` is unset, which paints "AD". An operator
using speech input and saying "click AD" opened nothing, and a screen reader
announced a name no sighted colleague could point at. That is WCAG 2.2 SC 2.5.3,
label in name, and axe reports it as `label-content-name-mismatch`.

The name is now `AD, account menu for dev@qcms.test`: the visible initials first,
then the account the menu belongs to (Code Owner, 2026-09-29). Nothing about the
button changes on screen. The initials lead rather than trail because speech input
needs a pronounceable prefix, and the whole sentence stays one catalogue entry with
two placeholders, so word order remains a catalogue decision rather than something
markup fixes (ADR-27).

**`aria-label` rather than visually hidden text.** The trigger is a 32px disc whose
entire content is centred, so a hidden span inside it is layout to get wrong for no
gain, and the vendored `Menu` already takes a `triggerLabel` for exactly this. The
alternative also splits one sentence across two catalogue entries joined by markup,
which is the thing ADR-27 asks callers not to do.

**The comment that argued the opposite is corrected rather than left standing.**
`components/account-menu.tsx` said the span's `aria-hidden` was what avoided a 2.5.3
mismatch. It never did: hiding text from the accessibility tree does not unpaint it,
the criterion is about what a sighted operator reads, and axe reports the node either
way. The attribute stays, because `aria-label` already replaces that content in the
name computation, but it is no longer presented as the reason.

**The test that failed to catch this is replaced by one that cannot miss it.**
`components/account-label-in-name.test.tsx` renders the trigger over five account
shapes - a display name whose initials are absent from the address, no display name
at all, the `Administrator` default, a non-ASCII name, and a one-character monogram -
and asserts for each that the computed accessible name STARTS with the text the
button actually paints, read back off the rendered node rather than from the
catalogue. The browser sweep gains a case signed in as an account whose address
provably cannot contain its initials, because the existing fixture's `E2E Admin` at
`e2e.<label>.<ts>@admin.test` let `label-content-name-mismatch` pass on the address
whatever the button painted.
