/**
 * Server entry (task 017; telemetry bootstrap added by task 054 / ADR-34).
 *
 * Deliberately tiny, and deliberately the only file in `apps/api` that runs
 * before the application graph exists. Two things happen here, in this order:
 *
 *  1. **Telemetry, if configured.** `startTelemetry()` starts the `NodeSDK` when
 *     `OTEL_EXPORTER_OTLP_ENDPOINT` is set and does nothing whatsoever when it is
 *     not (see `telemetry.ts` for why the gate is ours rather than the
 *     exporter's).
 *  2. **The server**, imported *dynamically* so that step 1 has already
 *     happened. This is the whole reason `main.ts` is a separate module: the OTel
 *     instrumentations patch `pg`, `pino` and `node:http` when those modules are
 *     first required, so a static `import { main } from "./main.js"` here would
 *     hoist the entire graph above the SDK and silently produce a process with no
 *     database or logging instrumentation. Any future work that needs something
 *     loaded at boot belongs in `main.ts`, never above this line.
 *
 * Node built-ins are allowed here (process boundary, not handler scope; R4).
 */

import { startTelemetry } from "./telemetry.js";

try {
  const telemetry = await startTelemetry();
  const { main } = await import("./main.js");
  main(telemetry);
} catch (err: unknown) {
  // Boot failure (invalid config): report and exit non-zero. ConfigError
  // messages name env vars only - never secret values (SEC-8).
  process.stderr.write(
    `qcms-api failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}
