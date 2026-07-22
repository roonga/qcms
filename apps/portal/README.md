# qcms-portal

The respondent portal (Next.js App Router): fast SSR pages for the devices that
open registration links, hydrating into the shared `@qcms/ui` renderer. Task 029.

## Architecture (ADR-26, R2)

- **SSR-first, fetch-only.** Pages fetch the current step + flow projection
  server-side, so the first paint is real content. No client data library
  (TanStack Query is admin-only). Minimal client state: the flow page hydrates to
  post answers per question and re-render branching.
- **Strict BFF (R2).** Route handlers under `app/**/route.ts` and the modules in
  `lib/server/` do proxy + session + credential duty ONLY: they attach the SEC-4
  internal token and the session bearer, forward to the internal API, and shape
  the result. They perform no rule evaluation and no validation authority (that
  is the API's, always). The portal imports nothing from `@qcms/core` (asserted
  by `lib/server/r2-import-surface.test.ts`). The internal API base URL and
  internal token are server-only (`lib/server/config.ts`).
- **Session token.** Held only in an httpOnly, SameSite cookie (`qcms_session`),
  never in client JS; secure in production (`lib/server/cookie-options.ts`). The
  client hydration talks to same-origin BFF proxy routes so the token never
  leaves the server.
- **Security headers.** `middleware.ts` sets a per-request CSP with a nonce for
  the inline theme script (never `'unsafe-inline'` for scripts). The Turnstile
  origin is admitted to the CSP ONLY when the challenge flag is on (SEC-9,
  `lib/server/csp.ts`). No CORS headers, ever (same-origin BFF).

## Routes

| Path | Purpose |
|------|---------|
| `/f/:formSlug` | Anonymous entry; Start POSTs to `/f/:formSlug/start` |
| `/f/:formSlug/start` | BFF: start session, set cookie, redirect to flow |
| `/l/:token` | BFF: verify secure link, redirect to flow or `/link-error` |
| `/s/:sessionId` | SSR flow page (real step content), hydrates for answering |
| `/s/:sessionId/answers` | BFF proxy: submit one answer, return re-evaluated step |
| `/s/:sessionId/submit` | BFF proxy: submit session, store receipt, go to `/done` |
| `/done` | Completion receipt (submittedAt + contentHash) |
| `/link-error`, `/expired` | Friendly typed-error pages |

## Theming (ADR-26): the single adopter override point

The portal ships a refined, brand-neutral default. Adopters re-skin it by editing
ONE file, `app/adopter-theme.css`: set `--font-portal` and override any of the
`--color-*` tokens (provide both a light `:root` value and a dark `:root.dark`
value, each at WCAG 2.2 AA). Do not edit `globals.css` or the component styles.
The brand-neutral defaults live in `@qcms/ui/theme.css`. Light + dark are both
supported; the theme is chosen by `?theme=`, a cookie, or `prefers-color-scheme`.

## Environment

See `.env.example`. Server-only: `QCMS_API_BASE_URL`, `QCMS_INTERNAL_TOKEN`.
Optional challenge: `QCMS_FLAG_CHALLENGE_PROVIDER=turnstile` + `QCMS_TURNSTILE_SITE_KEY`.

## Progressive enhancement: no-JS submission (task 044)

The flow works with JavaScript disabled. The SSR paints a natively submittable
`<form method="post">` (the `@qcms/ui` renderer's opt-in native-submit mode): the
controls serialize their answers natively and a real submit control POSTs the
whole step to the BFF's `/s/:sessionId/step` route, which forwards each answer to
the API, and - once the API says the flow is ready - submits the session and
redirects to the receipt. Each step is a full page reload (classic
post/redirect/get); branching re-renders on the reload. On a validation failure
the step re-renders with the API's typed errors in the error slots.

When JavaScript runs, `ProgressiveStep` swaps the native form for the controlled
per-answer `StepFlow` after hydration, so exactly one form is live at a time (no
double-submit) and the JS experience is unchanged. The whole-step route stays a
strict proxy (R2): it maps form fields to canonical answers and forwards them; the
API remains the sole validation and rule authority.

One caveat: the fixture's number follow-up ("How many?") is a react-aria
NumberField whose editable input needs JavaScript to sync its form value, so a
no-JS respondent who reaches a numeric question cannot enter it. The no-JS e2e
therefore drives the boolean branch. A native numeric fallback is a possible
follow-up (see the task 044 friction note).

## Run the portal for the manual pass

To serve a real published form locally (for the task-030 manual screen-reader
pass, or just to click through the flow), run from the repo root:

```
pnpm dev:portal
```

This one command brings up the dev Postgres (`docker-compose.dev.yml`,
`QCMS_DB_PORT=5433`), migrates it, seeds and publishes the kitchen-sink form
(`frm_kitchen_sink`: every question type plus two branch rules) through the same
publish pipeline the e2e seed uses, then starts the API and this portal wired
together and waits until both are healthy. Seeding is idempotent. When ready it
prints the respondent URL:

```
http://localhost:3000/f/kitchen-sink
```

Open it, click **Start**, and walk the flow. Stop with **Ctrl+C** (stops the API
and portal); the Postgres container is left up. Remove it with:

```
docker compose -f docker-compose.dev.yml down
```

The internal service token is generated in memory per run and never written to a
file. Ports are overridable via `QCMS_DEV_PORTAL_PORT`, `QCMS_DEV_API_PORT`, and
`QCMS_DB_PORT`. See `docs/a11y-manual-pass-checklist.md` for the full pass script.

## Tests

- Vitest (below the browser): `lib/server/*.test.ts` cover the R2 import surface,
  cookie security, the SEC-9 CSP-by-flag, and the challenge flag.
- Playwright (browser e2e, ADR-23): `e2e/*.pw.ts` run against a composed API with
  a seeded insurance form. The root `playwright.config.ts` is the one browser-test
  config for the repo; 030-035 extend it.
