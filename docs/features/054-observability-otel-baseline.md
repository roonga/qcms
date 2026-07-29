# 054 - Observability: OpenTelemetry tracing baseline + correlated logs

**Stage:** 8b (pre-launch operability; pulled forward by Code Owner call 2026-07-29 to run immediately, beside the admin train) · **Apps/packages:** `apps/api`, `apps/portal` (composition roots only) · **Depends on:** 029 (portal BFF), 017 (API request logging). Disjoint from 031-035 (`apps/admin`); merges serialize as usual.
**References:** ADR-34 (this task implements it) · working record `plan/observability-plan.md` (rev 3, verified against the official OTel JS docs, the Next.js OTel guide, and `@hono/otel` 1.1.2 source) · SEC-4 (internal token) · R2 (strict BFF) · issue #102 (CI failure forensics, reused as capture harness).

## Context

The portal BFF does not forward `x-request-id`, so the browser -> portal -> API hop is uncorrelated; there is no distributed tracing anywhere. ADR-34 decides an OTel baseline: W3C Trace Context propagation, OTLP export, SDK wired only at composition roots per the official OTel JS setup, official instrumentation libraries throughout (nothing hand-rolled), allowlist redaction, and a hard no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. QCMS is adopter-hosted: we ship instrumentation and conventions, never a backend choice.

## Deliverables

- **API (`apps/api`):** `NodeSDK` bootstrap (`@opentelemetry/sdk-node`) at the `serve.ts` entry, gated so no SDK starts when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset (the OTLP exporter otherwise defaults to `localhost:4318` - the gate is ours). Server spans via `@hono/otel` middleware (it extracts inbound `traceparent` into a `SpanKind.SERVER` span; header-capture options stay unset). Instrumentations, explicit list only: `instrumentation-http`, `-undici` (outbound webhooks), `-pg` (parameter capture off), `-pino`. The injected `Logger` interface is unchanged; its implementation moves to pino so `instrumentation-pino` injects `trace_id`/`span_id` into every line when tracing is active. `requestId` recorded as a span attribute; `x-request-id` behavior byte-identical.
- **Portal (`apps/portal`):** Next's documented OTel route only - `instrumentation.ts` + `registerOTel` (`@vercel/otel`), same endpoint gating, `propagateContextUrls` covering the API origin so the BFF fetch carries `traceparent` over the SEC-4 hop. **No `instrumentation-undici` here** (Next's own `AppRender.fetch` span + `@vercel/otel` propagation cover it; adding undici double-instruments). Node runtime only (`NodeSDK` is not edge-compatible). The BFF also forwards `x-request-id` on its API fetches (the human-facing bridge).
- **Redaction (SEC-13):** allowlist-based span/log attributes. Never in any signal: respondent answer values, `LocalizedText` content, `lnk_` tokens, the SEC-4 internal token, auth secrets. Branded ids (`frm_`, `stp_`, `q_`, `ses_`) allowed as pseudonymous correlators. New SEC-13 row in `docs/SECURITY_DESIGN.md` documenting this and the adopter's telemetry-retention responsibility.
- **e2e proof:** a minimal in-test OTLP/HTTP receiver (test-support only, no new prod surface) captures exported spans during a traced respondent submit; assertions per exit criteria. Note the turbo strict-env trap: any `OTEL_*` var a turbo-run test must see needs `turbo.json` `globalPassThroughEnv` (the e2e jobs bypass turbo; unit-level tests do not).
- **Docs:** `docs/ARCHITECTURE.md` observability section; `docs/DEVELOPER_GUIDE.md` local-viewer recipe (standalone OTLP dashboard container - Aspire dashboard or Jaeger all-in-one - plus `NEXT_OTEL_VERBOSE=1`, expected root span `GET /path`); `docs/SECURITY_DESIGN.md` SEC-13. Dependency risk assessment in the PR per `CONTRIBUTING.md`.

## Exit criteria

1. One traced respondent submit yields one connected trace: portal server span and API `SpanKind.SERVER` span share a trace id (propagated via `traceparent` over the BFF hop), with pg spans under the API span - asserted against the in-test OTLP receiver, no external viewer.
2. With `OTEL_EXPORTER_OTLP_ENDPOINT` unset, no SDK starts, no exporter noise, and every existing gate runs byte-identically (CI itself is the evidence; no gate config changes except any `globalPassThroughEnv` additions).
3. `x-request-id` semantics unchanged (inbound honored, echoed, in error envelope); API log lines carry `trace_id`/`span_id` when tracing is active, via `instrumentation-pino`, not call-site changes; the BFF forwards `x-request-id`.
4. Redaction holds: a known submitted answer string appears nowhere in the captured OTLP payloads or either app's captured logs during the traced e2e run; SEC-13 row landed.
5. All existing suites green with the pino-backed logger (logger tests updated only where they asserted implementation details, never weakening the interface contract).
6. `pnpm verify` and `pnpm verify:browser` green; new dependencies (API: api/sdk-node/exporter-trace-otlp-http/instrumentation-http/-undici/-pg/-pino/semantic-conventions/@hono/otel/pino; portal: @vercel/otel + its documented companions) approved per policy, caret-pinned; `auto-instrumentations-node` not added.

## Out of scope

Admin app instrumentation (rides an admin-train task once `apps/admin` exists - same recipe as the portal); custom metrics; OTLP log export; browser-side telemetry; hashing ids in telemetry; bundling any viewer into `pnpm dev:portal` (recipe only); `@qcms/core` and all packages stay OTel-free (instrumentation-pg patches the driver from the app bootstrap - `@qcms/db` source untouched).
