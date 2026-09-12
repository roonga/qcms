---
"@roonga/qcms-observability": minor
"create-qcms-app": patch
---

Resolve the OpenTelemetry batch export timings from the standard environment variables,
and derive the browser suite's telemetry poll budget from them (issue #901).

`OTEL_BSP_SCHEDULE_DELAY` had been set in the Playwright harness since task 054 and
reached no processor. OpenTelemetry JS 2.x moved the batch variables' env fallbacks into
the compatibility shims that `@opentelemetry/sdk-trace-base` re-exports, which is not the
constructor the API calls, and `@opentelemetry/sdk-logs` publishes no such shim at all, so
`BatchLogRecordProcessor` has no env-reading path in any 2.x release. Every service
therefore ran on the library defaults of a 5 s span delay and a 1 s log delay while the
harness, its comments and two telemetry specs were all written as though export happened
in about half a second. Nothing was red: the only symptom was that
`apps/admin/e2e/otel-logs.pw.ts` polled a flat 20 s for a record whose pipeline could
legitimately take longer than that, and failed twice in one week under contention, on
delivery latency, reporting it as a missing record.

New in this package: `@roonga/qcms-observability/otel` exports `batchSpanExportTimings` and
`batchLogExportTimings`, which read `OTEL_BSP_SCHEDULE_DELAY`, `OTEL_BSP_EXPORT_TIMEOUT`,
`OTEL_BLRP_SCHEDULE_DELAY` and `OTEL_BLRP_EXPORT_TIMEOUT` from an explicit environment
record and fall back to the specification defaults, which are also the values the 2.x
constructors apply when given no options. So a deployment that configures nothing keeps
exactly the behaviour it had, and one that tunes export timing now gets what it asked for.
An unparseable value falls back rather than throwing: telemetry configuration must not be
able to stop a process from serving.

The API, the portal and the admin pass the resolved timings to their batch processors, the
harness sets all four variables for both dev servers and the composed API, and the two
telemetry specs poll `OTLP_DELIVERY_BUDGET_MS`, which is one batch delay per pipeline plus
one export attempt at its configured ceiling plus an ingest margin. Measured on the branch
from the request completing to both correlated log records being readable: 1.1 s, 1.6 s,
2.5 s, 3.4 s and 4.0 s before the delay reached the processors, at host loads from idle to
95 on 24 cores, and consistently under a second after. A failure now prints the elapsed
time, the configured delay and timeout, and which artefact never arrived, and every run
leaves the measured latency in `apps/portal/.playwright/otlp/delivery.txt`. No retry was
added around the assertions: a retry would turn a slow pipeline into a pass, which is the
mis-attribution issue #604 is about.

The scaffolded templates carry the same three call sites, so a project generated from
`create-qcms-app` gets the explicit timings too.
