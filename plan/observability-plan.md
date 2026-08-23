# QCMS observability plan (OTel baseline)

**Status:** PO draft for Code Owner review, 2026-07-29 (rev 2 same day: implementation anchored on the official OTel JS setup - NodeSDK bootstrap, Next's documented route, official instrumentation libraries including `@hono/otel` and `instrumentation-pino` - replacing the hand-rolled middleware/logger-enrichment sketch, per Code Owner direction. rev 3 same day: verified against the Next OTel guide and `@hono/otel` 1.1.2 source - portal needs no undici instrumentation, `propagateContextUrls` must cover the API origin, no-op gating spelled out, `@hono/otel` inbound-context extraction confirmed in source). On ratification this becomes an ADR (next free number: ADR-34; re-verify at landing) plus one task file; this document stays as the working record.
**Prompted by:** the consolidated-local-logs discussion and the coming admin train (three services in local dev), plus the external-tester launch gate (038) needing real request forensics.

## 1. Current state (verified 2026-07-29)

- **API (`qcms-api`):** `apps/api/src/middleware/request-logger.ts` (task 017) assigns a correlation id per request (honours inbound `x-request-id` up to 200 chars, else WebCrypto UUID), stores it on context, echoes the response header, and logs one structured line (id, method, path, status, durationMs) through the injected `Logger` dep. Answer content is never touched. The error envelope carries the same id.
- **Portal (`qcms-portal`):** the BFF does **not** forward `x-request-id` on its API fetches, so the browser -> portal -> API hop is uncorrelated today. No portal-side request logging convention.
- **No OpenTelemetry anywhere.** No `@opentelemetry/*`, no pino/winston; logging is the API's injected-Logger pattern only.
- **DB:** Drizzle over `pg` (node-postgres) - the standard `@opentelemetry/instrumentation-pg` applies.
- **Local dev:** `scripts/dev-portal.mjs` interleaves child stdout/stderr with `[name]` prefixes - consolidated text logs already exist for the two-service flow.
- **CI:** failure forensics (issue #102) captures portal/API server logs as artifacts on failure.

## 2. Shaping constraint: the distribution model

QCMS is adopter-hosted (shadcn-style). We therefore ship **instrumentation and conventions, never a backend choice**: vendor-neutral OTel, OTLP export, off unless the adopter turns it on. Alerting, SLOs, dashboards, retention are adopter territory.

## 3. Principles

- **P1 - OTel is the single standard.** W3C Trace Context (`traceparent`/`tracestate`) for propagation, OTLP/HTTP for export. No vendor SDKs, ever.
- **P2 - SDK only at composition roots, wired the documented way.** The OTel **SDK** is wired in exactly two places, each following the official OTel JS setup (opentelemetry.io/docs/languages/js): the API entry uses the canonical `NodeSDK` bootstrap from `@opentelemetry/sdk-node`, and the Next.js apps use Next's own documented OTel route (`instrumentation.ts` + `registerOTel`). (The zero-code `--require .../register` hook is the docs' other path, but it rides the `auto-instrumentations-node` meta package - see the exclusion in section 7 - so the explicit bootstrap is the recommendation.) Library packages take at most `@opentelemetry/api` (a no-op when no SDK is registered). **`@qcms/core` stays completely OTel-free** - the kernel is pure (R4); spans around rule evaluation and compilation belong to callers. Determinism and the golden corpus are untouched by construction: spans wrap outputs, never appear in them.
- **P3 - Standard knobs, not new ones.** Configuration via standard `OTEL_*` env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER`). Telemetry is a no-op unless the endpoint is explicitly set - CI and default dev runs stay exactly as they are. Implementation note: the OTLP exporter's own default is to try `localhost:4318` when the env var is unset, so the no-op is enforced by each app's `register()`/bootstrap gating on `OTEL_EXPORTER_OTLP_ENDPOINT` being present before starting any SDK - no exporter noise when disabled. No new `QCMS_` flags unless we hit something OTel genuinely does not standardize.
- **P4 - Privacy by allowlist (the QCMS-specific rule).** Span attributes and log fields come from an explicit allowlist. **Never recorded in any signal:** respondent answer values, `LocalizedText` content, secure-link tokens (`lnk_`), the SEC-4 internal token, auth secrets, and (once 031 lands) admin credentials/TOTP material. Branded ids (`frm_`, `stp_`, `q_`, `ses_`) are allowed as pseudonymous correlators and documented as such. `db.statement` capture: parameterized SQL text only, parameter values explicitly off. This becomes a SEC row (SEC-13 candidate) in `docs/SECURITY_DESIGN.md`.
- **P5 - `x-request-id` stays.** It is the human-facing correlation token (error envelope, support). The bridge: the portal BFF starts forwarding it; it is recorded as a span attribute; log lines gain `trace_id`/`span_id` when a span is active. `traceparent` becomes the machine propagation truth alongside it, not instead of it.

## 4. Signals, scoped

**Traces (the core of this plan).** Instrumentation is the official libraries throughout - nothing hand-rolled, so behaviour tracks the spec as the packages evolve.

- The trace **starts at the portal server** (SSR/BFF route handlers). Browser-side telemetry is out of scope for launch (CSP surface, consent/privacy, payload cost - and R2 means the browser only ever talks to the portal anyway).
- Portal: Next's documented OTel setup (`instrumentation.ts` + `registerOTel`). **No extra fetch instrumentation needed** - Next itself already emits the `fetch [method] [url]` span (`AppRender.fetch`) and `@vercel/otel` carries context propagation; adding `instrumentation-undici` here would double-instrument the BFF hop. One knob to verify at implementation: `@vercel/otel` only injects `traceparent` into fetches whose URL matches its propagation allowlist, so the API origin must be listed (`propagateContextUrls`). Portal and admin stay on the Node runtime (they do today; `NodeSDK` is not edge-compatible per the Next guide, and R2's BFF is server-side anyway).
- API: the official Hono middleware (`@hono/otel`, v1.1.2 at writing) opens the server span and extracts inbound W3C context - verified in its source: `propagation.extract(otelContext.active(), c.req.header())` into a `SpanKind.SERVER` span with semconv method/route/status attributes. Its header-capture options (`captureRequestHeaders`/`captureResponseHeaders`) stay unset except for an explicit allowlist (P4). It sits beside `request-logger.ts` at the composition root. The middleware itself depends only on `@opentelemetry/api` + semantic conventions - exactly the P2 shape.
- DB: `@opentelemetry/instrumentation-pg`, statement text on (parameterized), parameter capture off (P4).
- Instrumentation selection: an **explicit list** of official packages - in the **API**: http, undici (outbound webhook calls), pg, pino; in the **portal/admin**: none beyond what `@vercel/otel`/Next provide built in. Not the `auto-instrumentations-node` meta package - same official code, but it drags in 100+ instrumentations against our dependency policy.
- Admin (031+): same recipe as the portal; joins when the app exists.

**Logs.** Keep the injected `Logger` interface (the DI seam handlers already use) but back the implementation with **pino**, and get trace correlation the formal way: `@opentelemetry/instrumentation-pino` injects `trace_id`/`span_id` into every line automatically - no custom context-lookup code in our logger. Transport stays JSON-to-stdout (12-factor; adopters ship stdout wherever they like). **No OTLP logs export at launch** - the pino instrumentation gives correlated stdout without the Logs SDK surface; OTLP log shipping is a Phase 4 flip, not a rewrite, because the instrumentation already supports it.

**Metrics.** None custom at launch; duration/status/error-rate derive from spans. Product metrics (publish counts, submission rates) are Phase 4, demand-driven.

## 5. Local dev experience

- Consolidated text logs: already there via `scripts/dev-portal.mjs` prefixes; extend to the admin app when it joins the dev flow (natural same-area rider on the admin task that first needs the full local stack).
- Trace viewer, optional: one documented command to run a standalone OTLP dashboard container (Aspire dashboard or Jaeger all-in-one - single container, ephemeral, traces visible in a browser) plus `OTEL_EXPORTER_OTLP_ENDPOINT` pointing at it. A `docs/DEVELOPER_GUIDE.md` recipe, not a requirement, and no repo dependency on either image. The recipe also names `NEXT_OTEL_VERBOSE=1` (Next emits more spans than its default set when debugging) and the expected root span shape (`GET /requested/pathname`).

## 6. Erasure/retention interplay

`ses_` ids exported to an adopter's telemetry backend are outside our erasure reach (the retention/erasure story in `@qcms/db` governs our Postgres only). Position: the ids are random and opaque (pseudonymous), telemetry is opt-in, and the SEC row documents that adopters owe their own telemetry-retention decision. No hashing at launch (D3 below if the Code Owner disagrees).

## 7. Dependencies (CONTRIBUTING approval list, all Apache-2.0, CNCF-governed)

API: `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/instrumentation-http`, `-undici`, `-pg`, `-pino`, `@opentelemetry/semantic-conventions`, `@hono/otel`, `pino` (logger implementation behind the existing `Logger` interface). Portal/admin: `@vercel/otel` plus its documented companions from the Next guide (`@opentelemetry/api`, `@opentelemetry/sdk-logs`, `@opentelemetry/api-logs`, `@opentelemetry/instrumentation`) - nothing else; Next's built-in spans cover the rest. Possibly `@opentelemetry/api` in `@qcms/db` if the pg instrumentation needs a hook there - prefer apps-only. Caret ranges per the #125 pin policy (not framework-tier). Risk assessment rides the PR per `CONTRIBUTING.md`. Deliberately excluded: `auto-instrumentations-node` (meta-package bloat; the explicit list above is the same official code) and `instrumentation-undici` in the Next apps (double-instruments Next's own fetch span).

## 8. Rollout recommendation

1. **ADR-34 (one page):** the principles above - OTel/W3C/OTLP as the standard, SDK-at-composition-roots, allowlist redaction, off-by-default, `x-request-id` bridge, browser out of scope. Affected docs corrected in the same change (staleness rule): `docs/ARCHITECTURE.md` observability section, `docs/SECURITY_DESIGN.md` SEC-13 row, `docs/DEVELOPER_GUIDE.md` viewer recipe.
2. **One task file** (number from the ledger at landing): tracing baseline portal -> API -> db + log correlation + redaction allowlist + docs. **Slot: after the admin train (031-035, 048, 049), before 038** - the external-tester gate is precisely when uncorrelated multi-service logs start costing real debugging time. Not on the admin train's critical path.
3. **Phase 4 (explicitly deferred):** custom metrics, OTel Logs pipeline, browser-side telemetry, admin-app observability dashboards, hashing of ids in telemetry.

**Exit-criteria sketch for the task** (to be firmed in the task file):

1. One respondent submit produces one connected trace (portal BFF span -> API server span -> pg spans) via `traceparent` over the BFF hop; e2e asserts propagation by matching `trace_id` in both apps' captured log lines - no viewer needed in CI.
2. `x-request-id` behaviour unchanged; log lines carry `trace_id` when tracing is active; with no OTLP endpoint set, telemetry is a no-op and all existing gates run exactly as today.
3. Redaction enforced by construction (allowlist wrapper), plus a test that a known submitted answer string never appears in the run's captured telemetry/log output (reuse the #102 forensics capture).
4. Docs updated per the ADR list; dependency approvals recorded in the PR.

## 9. Non-goals

Backend/vendor selection, alerting/SLOs, dashboards-as-code, browser RUM, client-side error reporting, log aggregation infrastructure - all adopter territory, documented as such.

## Open decisions for the Code Owner

- **D1 - slot:** after the admin train, before 038 (recommended) vs Phase 4 entirely. (Under discussion with the Code Owner 2026-07-29; a "DECIDED" note briefly committed that day was premature and is withdrawn - no decision yet.)
- **D2 - browser-side telemetry:** out of scope for launch (recommended) vs in.
- **D3 - `ses_` in telemetry:** allowed as pseudonymous (recommended) vs hashed at the exporter.
- **D4 - dev viewer:** documented optional recipe (recommended) vs wired into `pnpm dev:portal` behind a flag.

On a "go" (with D1-D4 calls or "use recommended"), the root conductor drafts ADR-34 and the task file in a reviewed PR.
