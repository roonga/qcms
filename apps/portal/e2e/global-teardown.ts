/**
 * Playwright globalTeardown (task 029): stop the composed API server and tear down
 * the Testcontainers Postgres booted in globalSetup. Runs in the same runner
 * process, so it reads the handles back from the api-server module singleton.
 *
 * The in-test OTLP receiver (task 054) is stopped LAST, so any span still in a
 * batch when the API stops is still received rather than becoming an export error
 * in the very logs the server-log gate reads.
 */

import { stopApiServer } from "./support/api-server.js";
import { stopOtlpReceiver } from "./support/otlp-receiver.js";

export default async function globalTeardown(): Promise<void> {
  await stopApiServer();
  await stopOtlpReceiver();
}
