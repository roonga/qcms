/**
 * Liveness probe for the admin app (task 031).
 *
 * Deliberately trivial and deliberately **credential-free and database-free**: it answers
 * "is this process serving HTTP", which is the only question a liveness probe should ask.
 * Readiness in the QCMS sense (can the database be reached) belongs to the API, which has
 * `/ready` for it; a Next front end that reported unready when Postgres blinked would take
 * the sign-in screen down with it.
 *
 * That independence is also what makes it the right target for the Playwright harness's
 * `webServer.url`. Playwright treats a 5xx as "not started" and gates `globalSetup` on
 * webServer readiness, so probing a page that needs the database would deadlock: the
 * database is what `globalSetup` is about to create.
 *
 * It reveals nothing (no version, no build id, no environment) because it is reachable
 * without authentication.
 */
export function GET(): Response {
  return new Response("ok\n", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
