HANDOFF: AWAITING-HUMAN rule on whether `POST /admin/links/{linkId}/revoke` may move to `POST /admin/forms/{id}/links/{linkId}/revoke`

Issue #478. Discovery is complete; implementation is deliberately not started.

## Why it is parked

The fix requires a breaking route change, which is the case the task brief says
to stop on. #305's equivalent needed a Code Owner ruling, and that ruling named
three routes, none of them this one.

Nothing in the request identifies a form:

- `apps/api/src/features/links/route.ts:66-80` declares the path as
  `/links/{linkId}/revoke`, whose only param is `LinkIdParam`. There is no body.
- `AdminPrincipal` (`apps/api/src/openapi.ts:26-35`) carries `userId`, `role`
  and `scopes`. No form scope, unchanged since #305 recorded the same.

So there is no form to put in the `where` clause. A scoped query is not
implementable without changing the request shape, and a partial landing (a
required `formId` on `revokeSecureLink` with no caller able to supply one) is
not a guard.

## What is established

**Ownership chain: direct.** `secure_links.form_id` is a column on the row
(`SecureLinkRow.formId`, `packages/db/src/queries/secure-links.ts`). No hop
through a session or a form version. `and(eq(secureLinks.linkId, linkId),
eq(secureLinks.formId, formId), isNull(secureLinks.revokedAt))` is the whole
predicate change once a form reaches the query.

**Siblings are already scoped.** Mint and list are `POST` / `GET
/admin/forms/{id}/links`; `listSecureLinks` filters on `secureLinks.formId` and
`insertSecureLink` writes the path's form. Revoke is the one outlier, matching
the issue's own neighbour audit.

**The public reads are legitimately unscoped.** `getSecureLink` and
`consumeSecureLink` serve start-session, where the caller is a respondent
presenting a signed token and no form scope exists to check against. Recorded
below as an observation, not a defect.

## The recommended shape

`POST /admin/forms/{id}/links/{linkId}/revoke`, matching #305 and putting revoke
beside the mint and list routes that already carry the segment. Response shape
is unchanged.

Call sites to update, from a tree-wide grep for the distinctive segment
`revoke`:

- `apps/api/src/features/links/{route,handler,schema}.ts`
- `apps/api/src/features/links/admin-mount.test.ts:45`
- `apps/api/src/features/links/links.integration.test.ts:165,180`
- `apps/portal/e2e/support/api-server.ts:208,214`
- `apps/admin/lib/server/links.ts:71-78`
- `apps/admin/app/(shell)/forms/actions.ts:454-456`
- `packages/db/src/queries/secure-links.ts` plus `queries/index.ts` and
  `import-surface.test.ts` if a new helper is added rather than the existing
  signature widened
- `docs/openapi/admin.json:3992` (regenerate, do not hand-edit),
  `docs/secure-links.md:105`, `docs/ARCHITECTURE.md:333`

The admin client is the cheap part: `revokeLinkAction` is already bound to the
form (`revoke={revokeLinkAction.bind(null, form.formId)}`,
`apps/admin/app/(shell)/forms/[formId]/links/page.tsx:53`) and drops the id
after using it only for `revalidatePath`. Threading it into the fetch is a
one-line change.

## Next step

With the ruling in hand: widen `revokeSecureLink` to take a required `formId`,
thread the path segment through the handler, and land the three-assertion test
set per #305 (positive in scope, fixture-is-real, negative cross-form asserting
404 and `revokedAt` still null). Prove the new predicate red by stripping that
predicate alone.
