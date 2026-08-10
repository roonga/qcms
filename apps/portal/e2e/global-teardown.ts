/**
 * Playwright globalTeardown (task 029): ask the composed API child to stop and tear
 * down its Testcontainers Postgres instance.
 *
 * The in-test OTLP receiver (task 054) is stopped LAST, so any span still in a
 * batch when the API stops is still received rather than becoming an export error
 * in the very logs the server-log gate reads.
 */

import { stopApiProcess } from "./support/api-process-control.js";
import { stopOtlpReceiver } from "./support/otlp-receiver.js";

export default async function globalTeardown(): Promise<void> {
  await stopApiProcess();
  await stopOtlpReceiver();
}
