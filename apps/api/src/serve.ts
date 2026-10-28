/**
 * `main.ts` is imported dynamically, and is a separate module for that reason: the OTel
 * instrumentations patch `pg` and `node:http` on first require, so a static import would
 * hoist the whole graph above the SDK and leave the process uninstrumented. Anything that
 * must load at boot belongs in `main.ts`, never above this line.
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
