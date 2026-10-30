HANDOFF: INTERRUPTED the admin half is written and compiles; two admin test suites are red

## Read this first (second executor turn, admin half)

The Code Owner ruled one PR, not a split, and the three deviations below were accepted and
still need recording in `docs/SECURITY_DESIGN.md` 8d, `plan/agent-everywhere.md` 7.2 and
the work order, dated 2026-10-30.

The admin half is now written and typechecks and lints clean. **It is not green**: two
admin suites are red and must be fixed first.

1. `lib/server/origin-guard.test.ts` drives every belted route end to end from a `ROUTES`
   table and asserts the table equals `BELTED_ROUTE_TEMPLATES`. `/assist` was added to
   `BeltRoute` and to `BELTED_ROUTES` in `lib/server/origin-belt-log.ts`, so that test
   needs a case for `app/(shell)/assist/route.ts` beside the `/forms/{formId}/assist` one.
2. `components/forms/form-builder.test.tsx`: three accept-path tests still fail to find the
   composer. `renderWithPanel` (added at the top of the describe) mounts the builder beside
   a bridge consumer that renders `AssistPanel`; the three failures are the renders that
   still need switching to it, or an await before the panel's first paint.

Still to do after that: `e2e/agent-launcher.pw.ts`, the docs above plus
`docs/agent-authoring.md` section 4, `pnpm qcms:sync-templates`, the changeset entry for
the admin half, deleting this file, then `pnpm verify`, the forced Docker run,
`QCMS_PORT_SEAT=7 pnpm up:e2e` and the detached browser gate, in sequence, and the PR.

What the admin half added: `lib/agent/{screens,panel,conversation,builder-assist-bridge}`,
`components/agent/{assistant-button,assistant-dock,assistant-conversation}`,
`app/(shell)/assist/route.ts`, the `agent.*` catalog keys, the panel CSS in
`app/globals.css`, the provider and both slots in `app/(shell)/layout.tsx`, and the
builder publishing its draft through the bridge instead of mounting the panel itself.
The context chip is one generic key rather than per-screen copy: a deviation to rule on.

## Where the API half stands

The API half of 082 is complete and green: `pnpm verify` passes, and
`pnpm exec turbo run test --force` ran 20 of 20 tasks with 0 cached.

Landed here:

- `apps/api/src/features/agent/` (moved from `features/forms/assist/`, routes and mount
  flag unchanged), with `screens.ts` holding the frozen `SCREENS` registry, `contexts/`
  holding a context builder per screen, and `tools/registry.ts` holding the frozen
  registry and the one door.
- `POST /admin/assist`, sharing the per-principal limiter key with the per-form route, and
  its route-policy row with the screen cell union.
- `packages/db` gains `listResponseMetadata` and `getResponseMetadata` (no answer column
  selected, no answer table joined), `latestVersionsByForm` and `findAdminById`.
- Tests: the registry and one-door tests, the schema vocabulary walk, the generalised
  sentinel test across every screen against a real database, the SEC-15 read row per
  conversation and filter set, and the shared limiter key across both routes.

## What is not done

The admin half of the work order, none of which is started:

1. `apps/admin/lib/agent/screens.ts` and the filesystem test that fails when a `(shell)`
   page has no row, following the pattern in `apps/admin/lib/rail-routes.test.ts`. The
   screen ids are the 23 in `apps/api/src/features/agent/screens.ts`, which is written
   against the route tree as it stands.
2. The conversation context under `apps/admin/lib/agent/`: one conversation per form
   subtree, a random conversation id minted per conversation, memory only.
3. The top-bar assistant button in `apps/admin/app/(shell)/layout.tsx`'s trailing group,
   after Exit and before the avatar, rendered only when `agentAuthoringEnabled()`.
4. The dock as a third track of the shell body grid, the expanded modal state and the
   sheet below `--bp-sidebar`, the edge separator's keyboard resize and the width menu,
   the panel cookie, and the rail held hidden at 1024 to 1279 px through
   `apps/admin/lib/sidebar.ts`'s hold (never the operator's cookie).
5. `apps/admin/app/(shell)/assist/route.ts`, with `isSameOriginPost()`, the session gate
   and a 404 when the flag is off, forwarding the headers the per-form route forwards.
6. The `agent.*` catalog namespace, the `globals.css` rules, and 080's closed page-route
   link allowlist replaced by the screen table.
7. `apps/admin/e2e/agent-launcher.pw.ts` and the browser gate, plus
   `QCMS_PORT_SEAT=<0-9> pnpm up:e2e` once for the new route-policy row.

## Deviations to review with the API half

- The work order asks for "a route-policy row per screen cell". `ROUTE_POLICIES` is keyed
  by method and path, so one path carries one row: the row names the union of the screens'
  first cells as an `anyOf`, and each context builder checks its own screen's cell through
  the same evaluator before it reads anything.
- Section 7.2's vocabulary is the stdout redactor's fragment list minus the
  staff-identity fragments, because Q11 allows staff names and emails to reach the
  provider. `REDACT_FRAGMENTS` is now exported from `@roonga/qcms-observability` so the
  test reads that list rather than restating it.
- `screen` and `conversationId` are optional on the per-form route's body and required on
  the screen route's, so the builder's existing turns stay valid: a turn naming no screen
  is a turn on the builder, and a named screen must be in that form's subtree.
