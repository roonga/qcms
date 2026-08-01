# qcms-admin

The QCMS authoring app (task 031): a Next.js app-router front end with a strict BFF and
its own better-auth instance. A separate deployable from the portal because the
enterprise topology puts it behind a VPN (`docs/ARCHITECTURE.md` §6); in the solo
topology it is protected by TLS plus 2FA instead (ADR-20).

## What is here at launch

| Area | State |
| --- | --- |
| Sign-in, TOTP 2FA enrollment, recovery codes, 2FA challenge, sign-out | built (031) |
| Settings: change password, 2FA status | built (031) |
| Questions: library list, editor, version timeline, preview, lifecycle | built (032) |
| Forms, Responses, Webhooks | placeholders; tasks 033-035 |

The shell nav, the auth gate, and the shared UI kit are what 031 delivers; the remaining
area screens are placeholders that name the task filling them.

## Running it

```bash
pnpm dev:portal                                    # dev Postgres up and migrated to head
cp apps/admin/.env.example apps/admin/.env.local   # then edit; DATABASE_URL -> port 7020
QCMS_ADMIN_EMAIL=you@example.test QCMS_ADMIN_PASSWORD='a long passphrase' pnpm qcms:create-admin
pnpm --filter qcms-admin dev                        # http://localhost:3000
```

Migrations are applied **programmatically**, not by the drizzle-kit CLI: `packages/db/drizzle.config.ts`
declares no `dbCredentials` (it exists to generate migrations, not to run them), so
`drizzle-kit migrate` cannot connect. `scripts/dev-portal.mjs` (`pnpm dev:portal`) brings up
the dev Postgres from `docker-compose.dev.yml` on port 7020 and migrates it to head with
the same package-owned migration set adopters run; it then also starts the portal and API,
which the admin does not need but which cost nothing to leave running. Point the admin's
`DATABASE_URL` at that database (`postgres://qcms:qcms@127.0.0.1:7020/qcms`), or at your own
Postgres migrated the same way.

`pnpm qcms:create-admin` is the **only** way an admin account is created, and it refuses
to run once any account exists (SEC-1: no self-registration path exists in any
composition). On first sign-in you are required to enroll a TOTP factor and are shown
recovery codes once.

`QCMS_ADMIN_2FA=optional` skips enrollment. It is a development escape hatch and the API
reads the same variable, so relaxing it in one place and not the other fails closed
(every admin API call 401s).

### Content to look at

An empty question library hides every state worth reviewing, so there is a seed:

```bash
DATABASE_URL=postgres://qcms:qcms@127.0.0.1:7020/qcms pnpm qcms:seed-fixtures
```

It loads the kernel's sample question corpus (`packages/core/fixtures/questions`) through
`parseQuestionDefinition`, never as raw inserts, and arranges the results so that all three
status badges, a multi-version timeline, a frozen version and a deprecated version all
exist without anyone clicking through the lifecycle first. It is idempotent: a question
that already exists is left alone, because an id is permanent (R6).

It is a **development** tool. It writes the database directly, which is why it lives in
`apps/api` rather than here: the admin never touches a domain table (R2).

## How it is put together

- **`app/(shell)/`** is the authenticated route group. Its layout calls
  `requireAdminSession()`, so **every** screen placed in it is gated by construction. Auth
  screens sit outside the group.
- **Question mutations are server actions** (`app/(shell)/questions/actions.ts`), unlike
  031's auth screens, which are route handlers behind full-page POSTs. The editor holds a
  live document and its failure mode is a validation error that has to land on a field
  without discarding unsaved work, which a redirect-with-an-error-code round trip cannot
  do. A server action is still a POST endpoint that nothing guards for you, so each one
  calls `requireAdminSession()` itself, and each returns the rejected submission alongside
  the error so the form can be restored (a form submitted before hydration posts as a full
  navigation, which resets client state).
- **The single-question preview is compiled by the API**, at
  `GET /admin/questions/{id}/versions/{v}/preview`, and only rendered here, through
  `A2UIStepRenderer` from `@qcms/ui`. Compiling in the app would put the compiler and the
  kernel behind it inside the BFF; leaving it in the API means preview and publish run the
  same code in the same process, so fidelity cannot drift. It is a recompilation of a
  possibly unpublished draft, which is why it exists only on the admin surface: the portal
  serves the stored compiled document and never recompiles (ADR-18).
- **`lib/server/`** is server-only and never reaches the client bundle: the better-auth
  instance, the database handle (auth only), the session reader, the CSP builder, and the
  one API client. `lib/server/r2-import-surface.test.ts` enforces that boundary, plus R2
  itself: no `@qcms/core` import, no domain-table access, and API calls only through
  `lib/server/api.ts`.
- **Auth flows are native form POSTs** to route handlers, not client fetches or server
  actions. The whole sign-in and 2FA loop therefore works before hydration and with
  JavaScript off, and no credential passes through client JavaScript.
- **`components/kit.tsx`** is the single `"use client"` boundary over `@qcms/ui/kit` (the
  vendored a2-react-aria components, ADR-22). It is a re-export with no wrappers: admin
  screens and rendered A2UI steps use literally the same components. Admin screens are
  ordinary React; A2UI documents appear only in the preview pane (task 034).
- **`app/theme.css`** is the QCMS app theme (task 055), generated by
  `plan/admin-theme/build.mjs` with a WCAG contrast gate around it and landed here
  byte-identical. It is the **only** file in this app allowed to write a colour down;
  everything else references `var(--...)`. `scripts/check-admin-theme.mjs` (in
  `pnpm check:all`) fails on a literal colour anywhere else, on drift from the design
  copy, and on any user-facing string that names this app "admin". Change the design in
  `plan/admin-theme/`, rebuild there, and copy the result back - never hand-edit the
  landed sheet.
- **Mode (light / dark / high-contrast) is a per-operator control**, not a deployment
  setting, and the app is never adopter-themeable (portal themes are for respondents). An
  explicit choice is the `qcms-app-mode` cookie, stamped as a root class by the root
  layout; with no choice, the sheet's own `prefers-color-scheme` block follows the machine.
  That split is why there is no pre-paint script here and no `script-src` allowance for
  one. High-contrast is never inferred.
- **`proxy.ts`** sets the security headers (SEC-9) and deliberately does **not**
  authenticate: a cookie-presence check there would look like security while proving
  nothing. See `lib/server/session.ts` for why the authority is the layout.

## Tests

| Layer | Where |
| --- | --- |
| BFF boundary, CSP, SEC-1 route tree | `lib/server/*.test.ts`, `proxy.test.ts` |
| First-run bootstrap against a real Postgres | `lib/server/bootstrap.integration.test.ts` (Docker) |
| Browser: the whole 2FA loop, axe in all three modes, keyboard | `e2e/*.pw.ts` (the root Playwright config) |
| Browser: mode default, persistence, no flash, Lexend | `e2e/appearance.pw.ts` |
| The theme gates themselves (tokens-only, drift, naming) | `scripts/check-admin-theme.test.ts` |

The browser suite rides on the one root Playwright config as the `admin-chromium` project
and shares the portal harness's Postgres and composed API, so `pnpm verify:browser` runs
it and so does CI's browser job.

Swapping better-auth for an external IdP: `docs/auth-swap.md`.
