# 017 — API composition root

**Stage:** 6 · **App:** `apps/api` · **Depends on:** 014 (helpers exist); 015 (sweep)
**References:** `ARCHITECTURE.md` §5.1–5.3 · ADR-08, ADR-09, ADR-13 · R4, R5 · `SECURITY_DESIGN.md` SEC-4, SEC-7, SEC-8 · review resolutions "outbox worker home", "ops story"

## Context

The Hono skeleton every slice mounts into: middleware, mount flags, health, and the in-process schedulers. Slices (018–026) are folders exporting sub-routers; this task defines the contracts they conform to.

## Deliverables

- `apps/api/src/app.ts` — `createApp(deps, flags): Hono`. `deps` is an explicit dependency object (db client, config, clock, crypto keys, logger) — constructor injection, no DI container (.NET mapping: like a hand-rolled `IServiceProvider`, but it's just a typed object).
- **Mount flags**: `{ public: boolean, internal: boolean, admin: boolean }` controlling which route groups mount. Admin routes must not exist in a public-only process (ADR-09) — not 403, *404 with no route registered*.
- **Middleware** (composition root only):
  - Error envelope: every error → `{ error: { code, message, details? } }`; unexpected errors → 500 with an id, logged with stack, never leaking internals.
  - Structured logging: JSON lines to stdout (request id, method, path, status, duration); no logging library with Node-only APIs in handler scope (R4) — inject a logger interface.
  - Rate limiting: pluggable store interface (in-memory default; Redis is an adopter swap documented in the shell) — configured per-group in later tasks.
  - Internal service token (SEC-4): every internal-surface request must carry `QCMS_INTERNAL_TOKEN` (accepted-list for rotation); requests without it are rejected. The token authenticates the *channel* only — user authorization always comes from the forwarded user credential.
- `/health` (static ok) and `/ready` (checks DB with timeout) — mounted in every process shape.
- **Schedulers**, started by the server entry (`serve.ts`), *not* by `createApp` (tests compose apps without workers): outbox deliverer loop (delivery logic itself lands in 025 — here, the scheduling shell with start/stop and jitter) and retention sweep interval calling `sweepExpiredSessions`. Both gated by flags (enterprise: internal process only). Graceful shutdown: stop intake, finish in-flight, close DB.
- Config from env with a Zod-validated config schema (`DATABASE_URL`, `QCMS_MOUNT`, `QCMS_LINK_KEYS`, `QCMS_SESSION_KEYS`, `QCMS_INTERNAL_TOKEN`, `QCMS_APP_KEY`, TTLs, rate limits — the SEC-7 inventory; key-list envs: first entry signs, all verify) — validate presence *and shape* (min lengths) at boot, fail fast, **never echo values** (SEC-8). Webhook signing uses per-webhook secrets stored encrypted under `QCMS_APP_KEY` (SEC-6), not a global env key.
- **Feature-flag registry (ADR-24):** a typed `flags` section of the config schema — every flag declared in code (name, type, default, description), parsed from `QCMS_FLAG_*` envs; unknown or malformed flags fail boot. First entries: `QCMS_FLAG_CHALLENGE_PROVIDER` (`none` | `turnstile`; Turnstile secrets required by validation iff `turnstile`) and `QCMS_ADMIN_2FA` folded into the registry. Flags reach handlers via `deps`; never sent to clients.
- Slice conventions documented (`apps/api/CONTRIBUTING.md`): folder layout (`features/<area>/<slice>/{route.ts, schema.ts, handler.ts, test.ts}`), `app.request()` testing pattern, transaction ownership.
- **Route-definition convention:** routes are declared with `@hono/zod-openapi`'s `createRoute` (request/response Zod schemas, typed error responses, and SEC-5 scope annotations as security metadata) — never bare Hono routes. This makes the OpenAPI documents (027) generated artifacts that cannot drift; Zod stays the single schema language and the implementation's source of truth.

## Exit criteria

1. `app.request('/health')` and `/ready` tests (ready fails cleanly with DB down).
2. Mount-flag tests: admin route 404s in public-only composition; present in admin composition.
3. Error envelope test: a throwing test route yields the envelope, a log line, and no stack in the body.
4. Config validation test: missing `DATABASE_URL` exits with a readable message.
5. Scheduler shell: start/stop idempotent; sweep fires on a short test interval against the harness DB.
6. Service-token middleware: internal-surface request without, or with a wrong, `QCMS_INTERNAL_TOKEN` → 401 (SEC-4); config-failure output contains no secret values (redaction test, SEC-8).
7. Flag registry (ADR-24): unknown `QCMS_FLAG_*` env rejected at boot; `QCMS_FLAG_CHALLENGE_PROVIDER=turnstile` without Turnstile secrets fails fast; default `none` requires nothing.

## Out of scope

All feature slices (018–024), webhook delivery logic (025), auth middleware specifics (021+ / 031), TLS/proxy (036).
