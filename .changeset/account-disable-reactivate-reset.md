---
"@roonga/qcms-db": minor
"create-qcms-app": minor
---

Add the account lifecycle queries behind disable, reactivation, credential and factor reset,
and the re-confirmation of a suspended membership (task 091).

`disableAccount` marks an account disabled and removes its Site administrator role;
`reactivateAccount` and `unclaimAccount` return it to unclaimed; `deleteAccountPassword`
removes its password credential. `suspendResponseMemberships` suspends every membership of a
group carrying a response role and records who performed the act, and `findHoldSuspension`,
`reconfirmHold` and `listActiveAdministratorsFor` decide and lift a suspension.
`suspendHold` suspends one, for a grant by the person who performed the reset. `listAccountHoldings`
reports what an account holds for the disable confirmation. `signInLinkHold` tells the sign-in
hook that an unclaimed account still has an unspent link or an unfinished reset,
`deletePendingTwoFactorSignIns` drops its open second-factor challenges,
`deleteTrustedDevices` forgets every device it trusted to skip the factor, and
`issuedPendingResetLink`, `wasSentResetOrReactivationLink` and `newestSignInLink` read its reset
history.

The scaffolded apps gain `GET /admin/accounts/{id}/holdings`, `POST /admin/accounts/{id}/disable`,
`/reactivate` and `/reset`, and
`POST /admin/workspaces/{id}/access-groups/{teamId}/holders/{userId}/reconfirm`. The claim
endpoint now answers reactivation and reset links, spends a reset link on a wrong current
password, and a response export's guard reads the disabled flag alone. A resent reset or
reactivation link keeps the issuer of the link it replaces.
