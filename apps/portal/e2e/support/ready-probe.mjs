// One readiness request against a seat port, as a standalone process (issue #295).
//
// ## Why this is a separate process rather than a function
//
// The seat preflight runs at Playwright **config load**
// (`playwright.config.ts` -> `seatPreflight`), which is the only moment early enough
// to decide `reuseExistingServer` before Playwright acts on it. That moment is
// synchronous: the config module is transpiled and evaluated by Playwright's own
// loader, so there is no place to await an HTTP round trip, and Node offers no
// synchronous HTTP client.
//
// `spawnSync` of this script is the synchronous HTTP client. It costs one Node
// startup per occupied port, which is paid only when something is already listening
// on this seat's block - the case the preflight exists for, and never the common one.
//
// ## What "ready" means here
//
// The same line `portal-server.mjs` draws while waiting for the dev server to come
// up: a response with a status below 400. That ceiling is deliberate and was
// measured, not chosen (issue #381) - a dev server answering 500 on every request is
// not serving this app, and neither is one answering 404. A bare TCP accept is not
// enough either, which is exactly the orphan case issue #295 reported: a `next-server`
// reparented to pid 1 after its run was killed still holds the port and still accepts
// connections, and adopting it turns the next run into hours of two-minute timeouts.
//
// Exit codes: 0 ready, 1 not ready, 2 called wrongly (a harness bug, not a verdict).

import { get } from "node:http";

/** Highest status code that counts as "this server is serving". */
const READY_STATUS_CEILING = 400;

const [portArgument, path, timeoutArgument] = process.argv.slice(2);
const port = Number(portArgument);
const timeoutMs = Number(timeoutArgument);

if (!Number.isInteger(port) || !Number.isFinite(timeoutMs) || path === undefined) {
  process.exit(2);
}

let settled = false;

/** End the process on the first verdict, so a late `close` cannot overturn it. */
function settle(ready) {
  if (settled) return;
  settled = true;
  process.exit(ready ? 0 : 1);
}

// `localhost` rather than 127.0.0.1, matching the origin the suite browses and the
// URL Playwright polls, so a server bound only to ::1 is judged the same way here.
const request = get({ host: "localhost", port, path, timeout: timeoutMs }, (response) => {
  response.resume();
  const status = response.statusCode;
  settle(status !== undefined && status < READY_STATUS_CEILING);
});

// A listener that accepts and then says nothing is the orphan shape, so the timeout
// has to produce a verdict rather than hang: destroy the socket and let `close` settle.
request.on("timeout", () => request.destroy());
// `error` covers a refused connection; `close` is the backstop, so a destroyed socket
// can never leave this process alive with no verdict.
request.on("error", () => settle(false));
request.on("close", () => settle(false));
