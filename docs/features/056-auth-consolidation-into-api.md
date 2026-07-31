# 056 - Auth consolidation: better-auth moves into the API; the admin loses its database handle

**Stage:** 8b (ordering exception: runs after 035, before 036, so the compose task never provisions an admin database credential it would immediately have to take away) · **Apps/packages:** `apps/api`, `apps/admin` (`@qcms/db` auth exports are consumed by the API instead) · **Depends on:** 031 (auth exists) and 035 (admin train complete, so screens are not built while the auth seam moves).
**References:** ADR-35 as amended 2026-07-31 (the decision this task implements) · better-auth **1.6.25** vendor docs, checked at drafting time 2026-07-31: the Hono integration guide (mount shape `app.on(["POST","GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))`) and the options reference (`baseURL`, `basePath` defaults to `/api/auth`, `trustedOrigins`, dynamic baseURL with `allowedHosts` + `protocol: "auto"` for reverse-proxy setups, `useSecureCookies`) · `apps/admin/lib/server/db.ts` and `r2-import-surface.test.ts` (the boundary being removed and the test that becomes stricter) · `docs/SECURITY_DESIGN.md` (SEC-1 no-catch-all, SEC-4 internal token) · issue #211 (superseded by this task; close it here).

## Context

ADR-35 made the API the sole domain-data database client, with the admin's better-auth handle as the one scoped exception. The Code Owner decided (2026-07-31) to remove the exception entirely: better-auth's server instance moves into the API, the admin becomes a pure BFF for auth traffic too, and after this task exactly one process holds a database connection. The browser still talks only to the admin origin; auth requests reach the API through the admin's proxy, so no CORS surface appears.

## Deliverables

- **better-auth instance in the API:** the configured instance (session policy, twoFactor plugin, all 031 semantics) moves into `apps/api` owned shell code, mounted per the vendor's documented Hono shape on `/api/auth/*`, its adapter running on the API's existing Drizzle handle. `baseURL`/`trustedOrigins` configured explicitly for the proxied topology (the admin's public origin; prefer explicit config over inference, per the options reference).
- **Admin auth proxy:** the admin forwards `/api/auth/*` to the API through its strict-BFF layer, streaming the response back with `Set-Cookie` intact (note: multiple `Set-Cookie` headers need `Headers.getSetCookie()`, not `get()`). Cookies remain first-party to the admin origin; verify `Secure`/`HttpOnly`/`SameSite` flags survive the hop.
- **Session checks preserved:** every 031 semantic survives byte-for-byte in behavior - DB-row session verification with the raw token, the 12h absolute cap from `createdAt`, session deletion on 2FA sign-in, two-step 2FA enrollment, the route-handler gates on settings routes. The admin's server-side checks go through the proxied session read or the API's `admin-auth` middleware; nothing verifies a session by cookie signature alone.
- **Bootstrap moves:** the create-admin script and `countAdminUsers` usage relocate to the API side (script or endpoint; keep it non-network-exposed). Document the new invocation in the admin README.
- **The admin sheds its database:** `apps/admin/lib/server/db.ts` deleted; `pg`, `drizzle-orm`, and `@qcms/db` removed from `apps/admin/package.json`. The R2 import-surface test is **kept and tightened**, not deleted: it now asserts zero `@qcms/db` value imports and zero Drizzle client construction anywhere in the admin - the empty allowlist is the regression gate.
- **SEC review of the new mount:** auth endpoints are unauthenticated by design pre-sign-in; decide how they sit relative to the SEC-4 internal token and keep SEC-1's structural no-catch-all test intact over the new route group. Record any SECURITY_DESIGN delta in the same PR.
- **e2e re-wiring:** the admin Playwright suite passes with the `QCMS_ADMIN_E2E_FIXTURES` database seam redirected to wherever the API-side composition reads its URL; the fixtures flow is documented where it lives.
- **Docs in the same change:** `docs/ARCHITECTURE.md` §7 (identity) and §9 (topology: the admin-to-postgres edge and the database-clients paragraph revert to API-only); ADR-35's consequences updated to "implemented by 056"; `.env.example` files on both apps.

## Exit criteria

1. No database access in `apps/admin`: no `pg`/`drizzle-orm`/`@qcms/db` dependency, no connection string in its env surface, and the tightened import-surface test enforcing the empty allowlist is green.
2. All auth flows (sign-in, 2FA enroll, challenge, recovery codes, sign-out, password change, bootstrap) pass the existing e2e suite with unchanged user-visible behavior, through the proxy, cookies set on the admin origin only.
3. The four 031 session-policy semantics (raw-token DB verification, 12h absolute cap, 2FA sign-in session deletion, two-step enrollment) each have a passing test in their new location.
4. SEC-1's structural route test still proves no catch-all beyond the explicit mounts; the SEC decision for the auth group is recorded.
5. `docs/ARCHITECTURE.md` §7/§9 and ADR-35 updated in this PR; issue #211 closed as superseded.
6. `pnpm verify` and `pnpm verify:browser` green; no new dependencies beyond moving existing ones between workspaces.
7. The PR names the better-auth version and the vendor doc pages followed (Hono integration; options: baseURL/trustedOrigins/cookies), per the plan-against-official-docs rule.

## Out of scope

OTP/social providers (Phase 4); any change to session-policy semantics (this task moves them, it does not redesign them); portal auth (none exists); the scoped Postgres role of #211 (superseded - do not implement it); admin screen features; any `@qcms/core` change.
