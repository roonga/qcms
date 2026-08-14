# qcms-admin

The QCMS authoring app (task 031): a Next.js app-router front end that is a strict BFF and
nothing else. A separate deployable from the portal because the enterprise topology puts it
behind a VPN (`docs/ARCHITECTURE.md` §6); in the solo topology it is protected by TLS plus
2FA instead (ADR-20).

**It holds no database handle** (task 056; ADR-35 as amended 2026-07-31). better-auth runs
in the API, mounted on `/api/auth/*`, and this app forwards one named operation per auth
step over the SEC-4 internal channel, re-emitting the resulting cookies on its own
redirect. So the browser still only ever talks to the admin origin, cookies stay
first-party to it, and the API is the deployment's only database client. There is no
`DATABASE_URL` and no `QCMS_ADMIN_AUTH_SECRET` in this app's environment, and
`lib/server/r2-import-surface.test.ts` fails if either comes back.

## What is here at launch

| Area | State |
| --- | --- |
| Sign-in, TOTP 2FA enrollment, recovery codes, 2FA challenge, sign-out | built (031) |
| Settings: change password, 2FA status | built (031) |
| Questions: library list, editor, version timeline, preview, lifecycle | built (032) |
| Forms: builder, condition editor, validation panel, rule bench | built (033) |
| Forms: publish, draft preview, version history, secure links | built (034) |
| Responses: browser with filters, detail with the answer ledger, CSV/JSON export, erasure and the erasure log | built (035) |
| Webhooks: per-form endpoints with one-time secret reveal, delivery dashboard, dead-letter queue with redelivery | built (035) |

The shell nav, the auth gate, and the shared UI kit are what 031 delivers.

### Where the operations screens live, and why

Responses and webhook endpoints belong to a **form**, so they are sections of the form
(`/forms/{id}/responses`, `/forms/{id}/webhooks`) alongside the builder and the links.
The two top-level areas are the ones whose question is not about a single form: the
**erasure log** (`/responses/erasures`) is compliance evidence across every form, and
the **dead-letter queue** (`/webhooks`) is deployment-wide because "is anything stuck"
is an operational question, not an authoring one. Those are the shapes of the API routes
behind them (`GET /admin/erasures`, `GET /admin/outbox/dead-letters`), not a preference.

## Running it

```bash
# Pin the auth secret FIRST, before dev:admin starts the API. Leaving it unset gives the
# API a fresh one per run, and a fresh secret makes an existing TOTP enrolment
# permanently unverifiable (see "The first admin" below). dev:admin warns when it is unset.
export QCMS_ADMIN_AUTH_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")

pnpm dev:admin        # dev Postgres up and migrated, API + admin running, http://localhost:7040

# Second terminal, once per database. dev:admin prints this with the values filled in.
# Prompt for the passphrase: an inline assignment keeps it out of `ps` but writes it
# to your shell history (issue #460).
read -rs -p 'passphrase: ' QCMS_ADMIN_PASSWORD; echo
export QCMS_ADMIN_EMAIL=you@example.test QCMS_ADMIN_PASSWORD

DATABASE_URL=postgres://qcms:qcms@127.0.0.1:7020/qcms \
  QCMS_ADMIN_BASE_URL=http://localhost:7040 \
  QCMS_ADMIN_AUTH_SECRET=$QCMS_ADMIN_AUTH_SECRET \
  pnpm qcms:create-admin

unset QCMS_ADMIN_PASSWORD
```

There is no `.env.local` step and no separate `next dev`, and that is the point of the
launcher rather than a convenience. The admin needs the **same** `QCMS_INTERNAL_TOKEN` the
API is running with (SEC-4), and `scripts/dev-stack.mjs` generates that token per run and
writes it nowhere, so a hand-started admin could only get it by reading the API process's
environment. Starting both children from one process makes the shared value structural
(issue #281). `pnpm dev:portal` is the same script with the other front end, and the two
cannot share a seat because each starts its own API on `7S10` - see `docs/PORTS.md`.

Migrations are applied **programmatically**, not by the drizzle-kit CLI: `packages/db/drizzle.config.ts`
declares no `dbCredentials` (it exists to generate migrations, not to run them), so
`drizzle-kit migrate` cannot connect. The launcher brings up the dev Postgres from
`docker-compose.dev.yml` on port 7020 and migrates it to head with the same package-owned
migration set adopters run. The admin **does** need the API it starts alongside: every
screen and every auth step goes through it.

### The first admin (`pnpm qcms:create-admin`)

Still the **only** way an admin account is created, and it still refuses to run once any
account exists (SEC-1: no self-registration path exists in any composition). Since task 056
it is an **API-side** command, because the API is the process with the database and the
better-auth instance:

- Its environment is the API's, not this app's: `DATABASE_URL`, `QCMS_ADMIN_AUTH_SECRET`
  and `QCMS_ADMIN_BASE_URL` (plus `QCMS_ADMIN_EMAIL` / `QCMS_ADMIN_PASSWORD`, and
  optionally `QCMS_ADMIN_NAME`). It deliberately does **not** ask for the link keys,
  session keys or app key the running API needs - none is read on this path.
- For *this command* the secret does not have to match the running API's. It is validated,
  not used: the account is created with a salted password hash (secret-independent), no
  second factor is enrolled, and the one session the creation mints is revoked immediately,
  so nothing it writes is later decrypted elsewhere.
- **But the API's own secret must then stay stable, or enrolment dies.** better-auth stores
  the TOTP secret encrypted under it and decrypts with whatever the current value is -
  checked against better-auth 1.6.25's source, not inferred:
  `symmetricEncrypt({ key: ctx.context.secretConfig, ... })` at
  `dist/plugins/two-factor/index.mjs:105`, decrypt at
  `dist/plugins/two-factor/totp/index.mjs:188` (and `:122` for the URI reveal). Change the
  secret and the authenticator's codes are rejected for good - **and so are the recovery
  codes**, which this file used to claim survive because better-auth stores them as plain
  JSON. It does not: the plugin defaults `storeBackupCodes` to `"encrypted"`
  (`dist/plugins/two-factor/index.mjs:25-27`), so all ten (`.../backup-codes/index.mjs:15`,
  `amount ?? 10`) are encrypted under the same key (issue #319). `pnpm dev:admin` generates
  a fresh secret when the variable is unset (and says so on startup), which is why the
  block above exports it first. In a deployment, change the secret through the versioned
  `QCMS_ADMIN_AUTH_SECRETS` list rather than in place (`docs/operations.md`).
- Credentials go in the environment, never in arguments: an argument lands in every `ps`
  listing while the command runs. **An inline assignment keeps it out of `ps` but not out
  of your shell history** (issue #460), so prompt for it instead of typing it:

  ```bash
  read -rs -p 'passphrase: ' QCMS_ADMIN_PASSWORD; echo
  export QCMS_ADMIN_EMAIL=you@example.test QCMS_ADMIN_PASSWORD
  # ... run the command ...
  unset QCMS_ADMIN_PASSWORD
  ```

  `read -rs` never puts the value on a command line, so it reaches neither `ps` nor the
  history file. If you have already typed the command, a **leading space** suppresses the
  history entry only when `HISTCONTROL` includes `ignorespace` (bash) or
  `HIST_IGNORE_SPACE` is set (zsh), and neither is the default everywhere, which is why it
  is the fallback rather than the recipe.
- It builds first (`pnpm --filter qcms-api... build`) because the entry is compiled
  (`apps/api/dist/create-admin.js`), which is what makes it available inside the API
  container image.
- In a Compose deployment, run it there, with the values in the environment of the
  `docker` command and the variables named on its command line with no value attached.
  Prompt first, as above, then:
  `docker compose exec -e QCMS_ADMIN_EMAIL -e QCMS_ADMIN_PASSWORD api node dist/create-admin.js`.
  The `-e NAME=value` form would defeat the bullet above one process up, by putting the
  password in the docker CLI's argv (issue #440). The env the service already carries
  supplies the rest.

On first sign-in you are required to enroll a TOTP factor and are shown recovery codes
once.

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
  `requireAdminSession()`, so every **page** placed in it is gated by construction. Auth
  screens sit outside the group.
- **A layout gates pages, not request handlers** (issue #177). A Next layout never runs
  for a `route.ts` or a `"use server"` action, so each of those applies the policy itself:
  an action calls `requireAdminSession()`, a route handler calls
  `requireAdminSessionForRequest()` (the same three gates, answered as a 303 rather than
  as the 307 a thrown `redirect()` would produce). Both share one decision function in
  `lib/server/session.ts`, so a gate added there reaches pages and handlers together, and
  `lib/server/shell-route-guards.test.ts` fails if a handler under `(shell)` names
  neither.
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
- **The response export is a route handler, not a server action** (`app/(shell)/forms/[formId]/export/route.ts`), because its product is bytes for the browser to save rather than state for a component to render. The upstream body is passed through untouched: an export larger than this process's memory still works, the API's UTF-8 BOM and CRLF records survive (both of which a re-encode would break), and answer values never exist as a value this app could log or serialize.
- **A webhook secret exists in this app for one render.** `createWebhookAction` and `rotateSecretAction` are the only functions that ever hold one, and each hands it straight to the panel that shows it once. There is no "show secret" action anywhere, because the API stores ciphertext and has no route that could serve one (SEC-6). The endpoints table says "Stored, not retrievable" where a secret column would otherwise invite someone to look.
- **`proxy.ts`** sets the security headers (SEC-9) and deliberately does **not**
  authenticate: a cookie-presence check there would look like security while proving
  nothing. See `lib/server/session.ts` for why the authority is a database read there,
  applied by the layout for pages and by each request handler for itself.

## Tests

| Layer | Where |
| --- | --- |
| BFF boundary, CSP, SEC-1 route tree | `lib/server/*.test.ts`, `proxy.test.ts` |
| First-run bootstrap against a real Postgres | `lib/server/bootstrap.integration.test.ts` (Docker) |
| Browser: the whole 2FA loop, axe in all three modes, keyboard | `e2e/*.pw.ts` (the root Playwright config) |
| Browser: mode default, persistence, no flash, Lexend | `e2e/appearance.pw.ts` |
| Browser: the operations arc (browse, export, erase, dead-letter, redeliver) | `e2e/responses-ops.pw.ts` |
| The theme gates themselves (tokens-only, drift, naming) | `scripts/check-admin-theme.test.ts` |

The browser suite rides on the one root Playwright config as the `admin-chromium` project
and shares the portal harness's Postgres and composed API, so `pnpm verify:browser` runs
it and so does CI's browser job.

Swapping better-auth for an external IdP: `docs/auth-swap.md`.
