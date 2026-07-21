/**
 * Playwright globalSetup (task 029): boot the composed API + Testcontainers
 * Postgres once, seed the insurance fixture, and write the link-token fixtures the
 * specs read. Runs before any spec; the portal dev server (webServer) only reaches
 * the API during tests, so it may start before this completes.
 */

import { startApiServer } from "./support/api-server.js";

export default async function globalSetup(): Promise<void> {
  await startApiServer();
}
