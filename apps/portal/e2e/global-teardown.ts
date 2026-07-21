/**
 * Playwright globalTeardown (task 029): stop the composed API server and tear down
 * the Testcontainers Postgres booted in globalSetup. Runs in the same runner
 * process, so it reads the handles back from the api-server module singleton.
 */

import { stopApiServer } from "./support/api-server.js";

export default async function globalTeardown(): Promise<void> {
  await stopApiServer();
}
