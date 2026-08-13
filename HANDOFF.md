HANDOFF: AWAITING-HUMAN route-shape decision on #305 - form-scoped routes (breaking) vs an inert formScope on AdminPrincipal

Discovery is complete and is the deliverable. **No implementation code was written**, deliberately:
both candidate shapes touch something the task fenced off, so the shape is not the executor's to
settle. Whoever picks this up should not need to re-derive anything below.

Branch is at `origin/main` (`0f03faa`) plus this file only.

## The defect

`redeliver`, `erase` and `unflag` each take a client-supplied id straight from the path into a
mutation with no ownership or form-scope check. Confirmed on all three.

## The three call paths

They are not symmetric and do not share a slice.

| Op | Route | Handler | Operand |
|---|---|---|---|
| redeliver | `POST /admin/outbox/:id/redeliver` | `apps/api/src/features/outbox/handler.ts:168` | delivery uuid |
| erase | `POST /admin/sessions/:sessionId/erase` | `apps/api/src/features/responses/admin/handler.ts:393` | `ses_*` |
| unflag | `POST /admin/responses/:sessionId/unflag` | `apps/api/src/features/responses/admin/handler.ts:453` | `ses_*` |

## The two ownership chains

- **delivery -> form**: `webhook_deliveries.webhookId -> webhooks.formId`. Not via the session.
  `outbox_events` has no `form_id` column; the form id lives inside the JSON payload.
- **session / submission -> form**: `sessions.formId`.

**The chain is not merely available, it is already loaded and then spent on something else.**
`makeUnflagHandler` reads `session.formId` (handler.ts:476) to build the outbox payload, and
`eraseSession` returns `outcome.formId` (handler.ts:405). The data needed to authorize is in hand
at the moment of the mutation and is used for something other than authorization. This materially
lowers option A's cost and is worth knowing before the design is argued in the abstract.

## Two established siblings already use the correct idiom

- `getResponse(deps.db, formId, sessionId)` - `GET /admin/forms/:id/responses/:sessionId` is
  form-scoped by construction; a cross-form session yields `undefined` -> 404.
- `listRecentDeliveries(exec, formId, limit)` (`packages/db/src/queries/deliveries.ts:500`) joins
  through `webhooks.formId`, and its doc comment already states this issue's intent: "Scoped by
  form through the webhook ... it keeps one form's delivery history out of another's."

So the idiom is settled. The three destructive endpoints simply do not use it.

## Why the shape is materially different from "three handlers, one missing check"

**Nothing in the request identifies a form to check against.** `AdminPrincipal`
(`apps/api/src/openapi.ts:26`) carries `userId`, `role`, `scopes` and no form scope, and none of the
three routes carries a form id in its path. A single door that resolves operand -> owning form and
then asks "may this caller act on it?" therefore compiles today into allow-all: a guard with no
failing case, which is exactly what this issue's own DEFERRED comment argued against and what the
reversing comment still requires us to avoid.

For the guard to have a real failing case, **either the request or the principal must name a form.**
That is a decision, not a lookup.

## Option A - form-scoped routes (recommended)

`POST /admin/forms/:id/responses/:sessionId/erase`, `.../unflag`,
`POST /admin/forms/:id/deliveries/:deliveryId/redeliver`.

- Reuses the idiom the repo has already written down twice, with the rationale already recorded.
- Refusal semantics fall out of the scoped query: cross-form takes the same 404 as absent, so
  "does not exist" and "exists but is not yours" are indistinguishable for free.
- The form id is already in hand at both response call sites (see the chain note above).

Costs:

- **Breaking change to three admin API routes.**
- Admin client is cheap for erase/unflag: the call sites are already under
  `app/(shell)/forms/[formId]/responses/[sessionId]/page.tsx`, so `formId` is in scope.
- **Redeliver is the hard part.** The dead-letter worklist (`listDeadLetterDeliveries`,
  `packages/db/src/queries/deliveries.ts:370`) is cross-form by design and its rows carry no
  `formId`. It already joins `webhooks`, so `formId: webhooks.formId` is a one-line select
  addition, but that changes the dead-letters response shape and
  `apps/admin/components/ops/dead-letters.tsx`.
- Ripples into `apps/admin` (so `verify:browser` is required), `apps/api/e2e/support/clients.ts`,
  and `apps/api/src/openapi-document.test.ts`.

## Option B - inert `formScope` on the principal (fallback)

`AdminPrincipal` gains an optional `formScope?: readonly FormId[]`; absent means unrestricted, so
production behaviour under SEC-3's single role is unchanged. One middleware door resolves
operand -> owning form and 404s when a restricted principal excludes it.

- Genuinely one door, no breaking route change, no admin client change, likely no `verify:browser`,
  and it is precisely the seam the Phase-4 split plugs into.

Costs and risks:

- Needs a test seam. `registerAdminAuth` hardcodes
  `group.use("*", adminAuth(betterAuthSessionVerifier(deps)))`
  (`apps/api/src/middleware/admin-auth.ts:114`), and integration tests authenticate by seeding real
  `user`/`session` rows, so principal fields come from the database. Injecting a restricted
  principal needs either a verifier-injection seam or a scope column.
- Adding an authorization input to `AdminPrincipal` brushes against the task's "no change to SEC-3's
  role model" fence, and an unpopulated field invites the "speculative" objection.

## Recommendation

**Option A.** The negative case this issue needs - an id that genuinely exists but belongs to
another form - is only constructible if the request names a form. A reuses an existing, documented
idiom instead of introducing a second authorization mechanism, and its refusal semantics come from
the scoped query rather than a separate comparison that can drift. Absorb the dead-letters `formId`
addition as part of it.

If the breaking route change is unacceptable, B is the fallback, and it needs an explicit ruling
that the `formScope` field is in bounds.

## State

- Nothing is red. The tree is `origin/main` plus this file.
- `pnpm install` and `pnpm build` are green in the worktree, so implementation can start
  immediately once the shape is ruled on.
- Gates were not run: there is no change to gate.

## Next step

Await the route-shape ruling, then implement the chosen option with the test plan the issue already
specifies (per operation: a positive in-scope case, a negative cross-form case asserting refusal and
no side effect, and an assertion that the cross-form fixture is real before asserting it is
refused). See every new guard red before accepting it.
