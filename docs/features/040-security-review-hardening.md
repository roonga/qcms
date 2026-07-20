# 040 - Security review and hardening

**Stage:** 8b · **Execution order: after 036, before 038** (numbered 040 to avoid renumbering; the launch gate depends on it) · **Scope:** whole product
**Depends on:** 036 (and 037 if in scope for launch)
**References:** **`SECURITY_DESIGN.md` (SEC-1…12)** - this task executes its assurance plan §10

## Context

The structured pre-launch security pass. Most controls were built inside feature tasks; this task *verifies them as a system*, adds the cross-cutting hardening that has no single feature home, and produces the evidence 038 requires (zero open high-severity findings).

## Deliverables

- **Authorization matrix test suite** (`apps/api/e2e/security/`): every cell of SECURITY_DESIGN §3.2 asserted over HTTP - each surface probed with no credential, wrong credential, other-session credential, service-token-only, and expired/tampered tokens. Includes: session token from session A against session B (403/404, not data); admin routes 404 in public mounts and 401 unauthenticated in admin mounts; service token alone grants nothing.
- **Token/crypto verification:** purpose-claim cross-use rejected (session token as link and vice versa); rotation overlap works for session keys, link keys, internal token, webhook dual-signing; tampered/expired/replayed webhook signatures rejected by the documented consumer recipe; placeholder secrets refuse boot.
- **Header/cookie/CSRF pass:** automated assertions on both apps + API for CSP (no unsafe-inline), HSTS (ingress recipes per ADR-20; asserted in app production config where set), nosniff, frame-ancestors, Referrer-Policy; cookie flags; Origin/Sec-Fetch-Site enforcement on state-changing BFF routes; the no-CORS-headers assertion; body-size limits enforced.
- **Secrets and log hygiene:** redaction tests (secrets in config errors, tokens in logs); grep-based CI check that no logger call sites log answer values; `.env.example` scan (no live-looking values); scaffold-output secret scan wired into 037's CI if 037 shipped.
- **Least-privilege DB verification:** app role cannot DDL; reporting role is read-only (write attempt fails); erasure door scoped (016's test re-run in the composed stack); migration-role split per 036 docs.
- **Dependency + image pass:** `pnpm audit`/osv-scanner clean or triaged (documented exceptions with expiry dates); image scan (trivy) on the three production images; base digests pinned.
- **ASVS-oriented checklist:** an OWASP ASVS L2 pass over the API surface (auth, session, access control, validation, error handling chapters), recorded as `docs/security-review-<date>.md` with findings → fixed or ticketed with severity. Injection notes: Drizzle parameterization asserted (no raw SQL string interpolation - lint/grep check); JSONB answer values never interpolated into queries; CSV export formula-injection guard (`=`, `+`, `-`, `@` prefixed cells escaped - add to 023's export if missing).
- **Repo security posture:** `SECURITY.md` (private disclosure via GitHub advisories, response commitment, supported versions); branch protection + required CI verified; npm 2FA + provenance publishing configured and test-published to a scoped dry run.
- **Fix window:** high-severity findings fixed in this task; medium/low ticketed with owners; the review doc is the evidence 038's pre-flight cites.

## Exit criteria

1. Matrix suite green in CI (it stays in CI permanently - regression protection, not a one-off).
2. All SEC-1…12 rows in the traceability matrix check out; deviations documented in the review doc.
3. Zero open high-severity findings; review doc committed.
4. `SECURITY.md` published; provenance publish verified.
5. 038's pre-flight references this review doc by date.

## Out of scope

External penetration test (recommended post-launch - issue it), bug bounty (issue), mTLS between services (documented enterprise upgrade, operator's call), `/api/v1` PAT implementation (Phase 4; its scope annotations are verified present in route metadata only).
