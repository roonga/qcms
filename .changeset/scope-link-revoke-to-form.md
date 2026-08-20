---
"@qcms/db": patch
---

Scope `revokeSecureLink` to its form (#478).

The helper took a client-supplied `linkId` straight into an `UPDATE` with nothing
filtering on ownership, so any caller reaching it could revoke any link in the
deployment. `formId` is now a required parameter and joins the `where` clause, so
a link belonging to another form is a row the statement never matches.

Refusal falls out of the scoped query rather than an ownership check, following
the idiom #305 established: a cross-form link, a never-issued link and an
already-revoked link all return `undefined`, so callers answer one code and no
two error paths have to agree.

`getSecureLink` and `consumeSecureLink` stay unscoped, deliberately: they serve
start-session, where the caller is a respondent presenting a signed token and
there is no form scope to check against.

Breaking for callers of `revokeSecureLink`: the new `formId` parameter sits
before the optional `now`.
