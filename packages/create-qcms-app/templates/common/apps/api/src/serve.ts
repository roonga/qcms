/**
 * `main.ts` is imported dynamically: the OTel instrumentations patch `pg` and `node:http` on
 * first require, so a static import would leave the process uninstrumented.
 */

import { startTelemetry } from "./telemetry.js";

try {
  const telemetry = await startTelemetry();
  const { main } = await import("./main.js");
  main(telemetry);
} catch (err: unknown) {
  // ConfigError messages name env vars only, never secret values (SEC-8).
  process.stderr.write(
    `qcms-api failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}
