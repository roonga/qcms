# 029 - Portal app (SSR + strict BFF)

**Stage:** 7 · **App:** `apps/portal` · **Depends on:** 027 (API complete), 028 (renderer)
**References:** `ARCHITECTURE.md` §6 · ADR-08 · **R2** (no business logic in BFF) · ADR-12 · **Wireframe:** `docs/wireframes/portal-flow.md` (042)

## Context

The respondent experience: SSR pages for fast first paint on the devices that open registration links, hydrating into the shared renderer. Route handlers are a strict BFF - session cookie handling, server-held credentials, proxying to the internal API. R2 is absolute: the BFF performs no rule evaluation and no validation authority.

## Deliverables

- Routes: `/f/:formSlug` (anonymous entry → BFF calls start-session → sets httpOnly session-token cookie → redirect to flow) · `/l/:token` (secure-link entry, friendly typed-error pages for expired/consumed/revoked) · `/s/:sessionId` (the flow page, SSR: BFF fetches current step + flow projection server-side; first paint is real content) · completion page (receipt: submittedAt, contentHash) · error/expired pages.
- **BFF route handlers** (`app/api/*` or route handlers): proxy start-session/get-step/submit-answer/submit; hold the session token in an httpOnly SameSite cookie (never exposed to client JS); attach it as bearer to internal API calls; internal API base URL is server-only config. Nothing else - a handler exceeding proxy/session/credential duty fails review (R2).
- Hydration: SSR renders the step via 028 with values from `latestAnswers`; on hydrate, answers post per-question on change/blur (matching 019's per-answer model), branch changes re-render from the API's returned flow projection. A no-JS fallback: plain form POST per step submitting visible answers sequentially - degraded but functional (SSR promise kept honestly); document limits.
- Resume: revisiting `/s/:sessionId` with a valid cookie resumes at current step; without → friendly recovery page.
- **Challenge adapter (shell):** the Turnstile implementation of 026's seam, rendered pre-session on challenge-required forms **only when `QCMS_FLAG_CHALLENGE_PROVIDER=turnstile`** (ADR-24); with the default `none`, no Turnstile code loads and the CSP contains no Turnstile origin (SEC-9 - the CSP allowance is conditional on the flag, asserted in a test).
- Shell i18n: message catalog (buttons, validation chrome, error pages) in owned source - single locale content, catalog structure per ADR-11.
- Basic branding/theming slots (logo, CSS custom properties) - the shell adopters own.
- Playwright browser tests: anonymous + secure-link entry, branching walkthrough on the insurance fixture (follow-up appears/disappears), resume, submit, completion; mobile viewport + throttled network profile for the fixture flow. **This task establishes the root Playwright config and CI job (ADR-23)** - 030–035 extend it; no other browser-test framework is ever added.

## Exit criteria

1. Playwright suite green against a composed API (reuse 027 seed utilities).
2. SSR: flow page HTML contains the step's real content with JS disabled; no-JS step submission works for the minimal fixture.
3. R2 audit test: BFF handlers import nothing from `@qcms/core` except types (import-surface test - evaluation stays server-side in the API).
4. Cookie security: httpOnly, SameSite, secure-in-production asserted.
5. Insurance fixture completes on Playwright's mobile emulation with throttling, SSR first paint (Stage 7 exit criterion, formalized in 030's Lighthouse run).

## Out of scope

Accessibility deep-pass (030 - structure must still be sound here), admin app, OTP/social entry (Phase 4).
