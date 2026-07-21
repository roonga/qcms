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

## Known limitation: no-JS submission

With JavaScript disabled the SSR flow page still renders the real step content
(the SSR-content path is covered by the e2e suite). Full no-JS *submission* of
answers is not yet wired: the shared `@qcms/ui` renderer owns the step `<form>`
and the compiled A2UI document (served verbatim, ADR-18) cannot carry a POST
action or a submit control without a small `@qcms/ui` change (028 is complete and
frozen for this task). This is tracked as a follow-up; the JavaScript path is the
supported respondent experience.

## Tests

- Vitest (below the browser): `lib/server/*.test.ts` cover the R2 import surface,
  cookie security, the SEC-9 CSP-by-flag, and the challenge flag.
- Playwright (browser e2e, ADR-23): `e2e/*.pw.ts` run against a composed API with
  a seeded insurance form. The root `playwright.config.ts` is the one browser-test
  config for the repo; 030-035 extend it.
