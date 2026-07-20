# 027 - API end-to-end suite

**Stage:** 6 (exit gate) · **App:** `apps/api` · **Depends on:** 018–026 (all Stage 6 tasks)
**References:** `IMPLEMENTATION_PLAN.md` Stage 6 exit criteria

## Context

The Stage 6 gate: one scripted test drives the whole product over HTTP - no server, no ports, `app.request()` against the composed app with the real harness database. If this suite is green, the backend is launch-shaped. This is the **API scenario layer of ADR-23** (Vitest) - the e2e layer while the product is headless; browser e2e is Playwright, arriving with 029.

## Deliverables

- `apps/api/e2e/` suite covering, as *scenarios* (not per-slice re-tests):
  1. **The full loop:** admin auth stub → create questions (insurance set) → publish question versions → create form → draft with rules → publish → mint secure link → start session via link → walk the branching flow (get-step / submit-answer, asserting branch appearance/disappearance) → submit → observe the signed webhook arrive at an in-test receiver → export CSV and JSON containing the response → erase the session → export no longer contains it, tombstone listed.
  2. **Anonymous variant** of the respondent path.
  3. **Version pinning:** start session on v1 → publish v2 → session completes on v1; new session gets v2.
  4. **Mount-split:** the same respondent scenario against a public-only composition (admin 404), with authoring performed against a separate internal composition sharing the database - proving the enterprise topology works.
  5. **Failure tour:** publish with rule errors; invalid answers; expired link; consumed one-time link; submitted-session answer attempt; each asserting typed codes end-to-end through the envelope.
- Seed/fixture utilities shared with later portal tests (029) - export a `seedInsuranceForm(db)` style toolkit from a test-support package or folder.
- CI wiring: e2e job runs on every push (harness DB via testcontainers), separate from unit jobs for signal clarity.
- A `docs/api-walkthrough.md` generated-or-written from scenario 1: the curl-level story of the product (becomes README material for 036/038).
- **Generated OpenAPI documents:** `docs/openapi/respondent.json` and `docs/openapi/admin.json`, generated from the composed app's `@hono/zod-openapi` route definitions (017's convention) and committed; a CI check regenerates and asserts the committed files match (the 036 env-reference pattern). Labeled `x-stability: internal` - descriptive documentation of the current build, not a compatibility promise (the no-stability-contract stance of `ARCHITECTURE.md` §5.1 stands until `/api/v1`).

## Exit criteria

1. All five scenarios green in CI against the composed app (all groups) **and** scenario 4's split composition.
2. Suite runtime < 5 minutes in CI (parallelize files; the harness supports isolated DBs).
3. No slice-internal imports - scenarios use only HTTP and seed utilities (the suite is a consumer, proving the API is usable as one).
4. Committed OpenAPI documents validate against the OpenAPI spec (linted with a validator in CI) and deep-equal freshly generated output (drift check); every mounted route appears in exactly one document.

## Out of scope

Browser tests (029/030), load tests (Phase 4 issue if wanted), the admin UI.
