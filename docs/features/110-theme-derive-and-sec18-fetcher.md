# 110 - Theme derive route and the SEC-18 fetcher

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api` · **Depends on:** 107, 109
**References:** `plan/agent-builder-decisions.md` (A4, Q7, Q19, Q20, Q21, "Security review requirements": SEC-18 fetcher; "Required tests": Fetcher, Flag off) · SEC-18 (written by 106) · `docs/WORKSPACE_ACCESS.md` sections 3, 11 and 14 (criterion 119) · `plan/work-order-sequence.md`

## Context

The only outbound fetch the builder makes. `apps/api/src/features/webhooks/ssrf.ts` checks literals and pins no DNS answer, so nothing there is reused: the `BrandFetcher` port is new and is held to SEC-18 line by line. The user types the URL; the model never supplies it.

## Deliverables

- `POST` derive route on a workspace: Edit forms in that workspace; behind its own `QCMS_FLAG_*` flag, off by default and separate from the agent flag (Q20); optional operator egress allowlist or proxy; never the webhook `allowPrivate` switch.
- The `BrandFetcher` port and its hardened implementation:
  - every A and AAAA record checked, `::ffff:` mapped and NAT64 forms included; refused if any record is private;
  - connection to the pinned IP with SNI and certificate checks for the host;
  - https on port 443 only; userinfo in the URL refused;
  - exactly one same-site redirect (same registrable domain), fully re-validated; a cross-site redirect refused (Q19);
  - content-type allowlist confirmed by magic-number sniff; caps on decompressed bytes, image pixels, time and total size; the logo re-encoded;
  - each subresource (CSS, logo) through the same guard; no cookies sent;
  - one uniform error for every refusal, so the route is no port-scan oracle.
- Derive output: 107's derivation over the fetched colours and faces, as a strict schema of hex colours and a registry face enum, no free strings, no title or alt text (Q21). No page text and no logo bytes go to the model provider. PDF deferred.
- Rate limit per user and workspace; one access-audit row per fetch, with the source host (spec section 11).
- A fake `BrandFetcher` and a local fixture server for tests and for 117's Playwright run.
- Config parsing in `apps/api/src/config.ts`; `route-policy.ts` row; SEC-3 §3.2 row; OpenAPI.

## Exit criteria

Spec criteria owned: **119**. This task owns that and no others.

- Every SEC-18 line has a named test.

## Required tests

- Fetcher (X1): DNS rebinding between check and connect; mixed public and private records; a private record in mapped and NAT64 forms; redirect refused with no redirect allowed, cross-site redirect refused, one same-site redirect re-validated and a second refused; oversize body; slow body; gzip bomb; wrong content type; SVG or polyglot logo; port other than 443; userinfo; every refusal byte-identical.
- Flag off: with the agent flag on and the SEC-18 flag off, the derive route is 404.
- Authorisation: derive refused for everyone but an Edit forms holder of that workspace; each fetch writes one audit row (criterion 119).
- Output schema: a derive result with a free string fails the schema.
- Matrix rows (M) for the route.

## Files and areas

`apps/api/src/features/workspaces/` (derive route), `apps/api/src/features/workspaces/brand-fetcher/` (new port, implementation, fake), `apps/api/src/config.ts`, `apps/api/src/features/membership/route-policy.ts`, `apps/api/e2e/security/`, `docs/SECURITY_DESIGN.md` (§3.2 row), `docs/openapi/admin.json`, `packages/create-qcms-app/templates/` (env sample).

## Migration

None (108 adds the audit kind).

## Gates

V, D, E, M (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round (outbound fetch, SEC-18); Sonnet delta.

## Design gate

None. No UI.

## Out of scope

The `theme.derive` action kind, card and derive flow (117). Operator docs for the flag and egress (121).
