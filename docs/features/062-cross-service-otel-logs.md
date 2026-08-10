# 062 - Cross-service OTLP logs and trace correlation

**Stage:** 8b · **Apps/packages:** `apps/api`, `apps/portal`, `apps/admin` (server composition roots and strict BFF clients only) · **Depends on:** 054 (distributed trace and API stdout-log baseline), 031 (admin shell), 056 (admin-to-API auth boundary)
**References:** ADR-34 · SEC-13 · task 054 · product-observability issues #183, #184, #185 and #370.

## Context

Before this task, the developer LGTM overlay contained Loki and preconfigured trace/log correlation, but QCMS sent it traces only. The API wrote trace-correlated JSON to stdout without exporting logs; the Portal had tracing but no application logger; the Admin had neither tracing nor an application logger. An operator therefore could not follow one browser request through the BFF and API using the dashboard.

Exporting the existing stdout records unchanged is unsafe. SEC-13 deliberately removes free-text exception messages and stacks from exported spans because author-supplied validation content can reach them. OTLP logs cross the same retention and erasure boundary, so they require the same allowlist discipline rather than SEC-8's field-name denylist alone.

## Deliverables

- **One safe server logging contract across all three apps.** JSON remains on stdout. OTLP records carry a closed event name plus allowlisted operational fields only: severity/time, `requestId`, `trace_id`, `span_id`, method, normalized path, status, duration and explicitly approved counts/states. Arbitrary messages, errors, stacks, request/response bodies, headers, query strings, answer/localized content and credentials never enter OTLP.
- **API OTLP logs.** Configure an OTLP/HTTP log exporter and `BatchLogRecordProcessor` in the existing `NodeSDK`, after an allowlist processor, and emit through the shared OTel-aware logger. The existing `OTEL_EXPORTER_OTLP_ENDPOINT` gate remains the single switch and SDK shutdown flushes both signals.
- **API span cleanup.** Keep `@hono/otel` as the authoritative inbound SERVER span and suppress the duplicate raw `instrumentation-http` SERVER span (#184). Re-check the current `instrumentation-pg` release for `db.operation.name`; upgrade and close #183 if upstream now emits it, otherwise record the verified upstream block rather than inventing a query-name parser.
- **Portal OTLP logs.** Add the shared JSON server logger, log its centralized API boundary, and configure `registerOTel` with the same safe log processors while preserving Next's fetch instrumentation and trace propagation.
- **Admin traces and OTLP logs.** Complete issue #185: adopt the Portal tracing recipe with Admin-specific SEC-13 span redaction, add the safe logger at both admin API boundaries, and export logs. Auth/TOTP/password/cookie material is excluded structurally.
- **Human correlation.** Admin joins Portal in minting/echoing `x-request-id`; both BFFs forward it to the API. That id appears on safe BFF/API log records and the API span while W3C `traceparent` keeps the spans and logs in one trace.
- **Dashboard proof.** The in-test OTLP receiver captures `/v1/logs` beside `/v1/traces`; browser tests prove Portal -> API -> pg and Admin -> API traces have same-trace logs from both services. A dev-tools smoke check proves Loki and Tempo contain the same trace id without custom datasource configuration.
- **Docs.** Amend SEC-13 and every statement that says OTLP logs or Admin instrumentation are absent. Document stdout versus exported-record contents, retention, configuration and dashboard use.

## Exit criteria

1. A respondent action yields Portal and API log records sharing the connected Portal -> API -> pg trace id; an Admin operation yields Admin and API log records sharing a connected Admin -> API trace id.
2. The browser-visible `x-request-id` is identical in the BFF log, API log and API span for each flow.
3. A canary placed in an answer, validation message, password/TOTP-shaped field, exception message and stack appears nowhere in captured OTLP trace or log payloads. The exported log body and attributes are allowlisted before the batch processor queues them.
4. With `OTEL_EXPORTER_OTLP_ENDPOINT` unset, no tracing or logging SDK starts and stdout behaviour remains available.
5. The LGTM overlay requires no custom collector/datasource configuration: Loki receives `qcms-admin`, `qcms-portal` and `qcms-api` records and a log's trace id resolves in Tempo.
6. `pnpm verify` is green with forced tests reporting `0 cached`, and `QCMS_PORT_SEAT=0 pnpm verify:browser` is green.
7. `docs/SECURITY_DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/operations.md`, `docs/DEVELOPER_GUIDE.md`, the feature ledger and stale comments are updated in the same PR. The PR closes #184, #185 and #370, and closes #183 if its upstream acceptance criterion is now met.

## Out of scope

Browser-console telemetry and the Playwright console-census tooling request (#162); custom metrics; persistence or production deployment of LGTM; changing trace sampling; hashing branded ids; logging answer content under any opt-in mode; making logs available when tracing is disabled through a second switch.
