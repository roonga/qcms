---
"create-qcms-app": patch
---

Scaffold the account button's label-in-name fix, so an adopter does not inherit a
WCAG 2.2 SC 2.5.3 failure on every authenticated screen (issue #1010).

The templates are generated from `apps/admin`, so this is the scaffolded half of the
same change. The generated `components/account-menu.tsx` passes the monogram into the
catalogue message, `lib/i18n/en.ts` carries `{initials}, account menu for {email}`,
and `lib/initials.ts` no longer describes its result as decorative - it is the opening
words of the accessible name now, so a caller must paint and announce the same string.

This matters more in a scaffold than in our own tree: an adopter's first account is
created by the scaffolded `create-admin` path, which names it `Administrator` unless
`QCMS_ADMIN_NAME` says otherwise, and that is precisely the shape where the painted
"AD" appeared nowhere in the old name.
