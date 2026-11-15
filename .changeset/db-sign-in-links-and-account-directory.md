---
"@roonga/qcms-db": minor
---

Add `control.sign_in_links` and the account-directory queries that account creation and
claim read (task 090).

`sign_in_links` stores the SHA-256 digest of an emailed single-use link, never the token:
the token exists in the message and in the person's browser and nowhere else. Each row
carries its 72-hour expiry, a used flag, an invalidated flag for the link a resend
supersedes, and the delivery status the relay reported. `consumeSignInLink` is a
compare-and-set, so reuse and an expired link are refused by the same statement.

`listAccountDirectory` pages and filters accounts by role and status for the Site
administrator directory, and `accountStatusOf` derives `active`, `unclaimed` or `disabled`
from the two timestamps rather than storing a third.

`findUserByEmail` and `findUsersByIds` now also return `disabledAt` and `claimedAt`, so the
grant path can give an unknown, a disabled and an unclaimed address one identical answer.

Migration `0012_sign_in_links.sql` creates the table with ordinary control-plane DML for
`qcms_app_control` and nothing at all for any environment role.
