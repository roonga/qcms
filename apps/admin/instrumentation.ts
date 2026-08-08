/**
 * Admin server-process registration (issue #292).
 *
 * Next's documented startup hook: a root `instrumentation.ts` exporting `register()`,
 * which Next calls once per server process before anything serves. That makes it the
 * only place in a Next app where "refuse to boot" can mean boot rather than "500 on the
 * first request", which is why the cookie-security guard is called from here.
 *
 * The portal's twin (`apps/portal/instrumentation.ts`) does the same thing first and then
 * registers OpenTelemetry (task 054, ADR-34). This app has no OTel registration yet; when
 * it gets one it belongs in this file, after the guard.
 */

import { assertSecureCookiesConfigured } from "./lib/server/config";

/**
 * Refuse to start on a cookie configuration a browser will not protect (issue #292).
 *
 * **Exiting rather than only throwing is load-bearing**: Next catches an error from this
 * hook, reports `Failed to prepare server`, and then leaves a process listening that
 * answers every request with a 500. Nothing is served and no cookie is ever set, so the
 * security property holds either way, but neither app has a Compose healthcheck, so that
 * process reads as "running" to an operator and to `docker compose ps`. A non-zero exit is
 * the same refusal made visible: the container dies, `restart: unless-stopped` restarts
 * it, and the message is the last thing in `docker logs`.
 *
 * The guard on `process.exit` is for Next's edge runtime, which loads this hook too and
 * has no such function. Neither app runs anything on the edge runtime today; if one ever
 * does, it re-throws and gets the 500-on-everything behaviour instead of a `TypeError`
 * that hides the real message. `process.stderr` can be absent in that sandbox for the
 * same reason, so the write is optional-called: a missing stream must not become the
 * exception that swallows a refusal an operator needs to read.
 *
 * The twin is `apps/portal/instrumentation.ts`. **Change one, change the other.**
 */
function refuseInsecureCookieConfiguration(): void {
  try {
    assertSecureCookiesConfigured();
  } catch (error) {
    process.stderr?.write(`${error instanceof Error ? error.message : String(error)}\n`);
    if (typeof process.exit === "function") process.exit(1);
    throw error;
  }
}

export function register(): void {
  refuseInsecureCookieConfiguration();
}
