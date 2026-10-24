/**
 * Makes `http://localhost` real inside the dev container, so the suite browses the same
 * origin it does in CI. Chromium treats `http://localhost` as a trustworthy origin and a
 * bare gateway address as not, so browsing the gateway instead silently drops every
 * `Secure` cookie and sign-in appears to succeed and bounce.
 *
 * It forwards to the service containers on the Compose network rather than to a published
 * port, because the publish stays bound to loopback on the host and a sibling container
 * cannot reach that whatever address it dials.
 *
 * Its own process because the parent blocks its event loop for the whole run, and it exits
 * when stdin closes so it cannot outlive the run holding this seat's ports.
 */

import { connect, createServer } from "node:net";
import { pathToFileURL } from "node:url";

/** Loopback only. The forwarder must never widen what Compose chose to expose. */
const LISTEN_ADDRESS = "127.0.0.1";

/**
 * An establishment budget, deliberately not an idle one: an unreachable target otherwise
 * sits in the OS retry budget for minutes, while a browser legitimately holds keep-alive
 * connections idle for longer than any useful value here.
 */
export const CONNECT_TIMEOUT_MS = 10_000;

/**
 * @typedef {object} ForwardRoute
 * @property {number} listenPort port on this container's loopback.
 * @property {string} targetHost the service container's address.
 * @property {number} targetPort the port inside that container.
 */

/**
 * Validated rather than trusted: a malformed entry would otherwise surface minutes later
 * inside a Playwright timeout, reading like an application bug.
 */
export function parseRoutes(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`loopback-forward: routes must be JSON: ${String(error)}`, { cause: error });
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("loopback-forward: routes must be a non-empty array");
  }
  return parsed.map((route) => {
    const { listenPort, targetHost, targetPort } = route ?? {};
    if (!Number.isInteger(listenPort) || !Number.isInteger(targetPort)) {
      throw new Error(`loopback-forward: listenPort and targetPort must be integers`);
    }
    if (typeof targetHost !== "string" || targetHost === "") {
      throw new Error("loopback-forward: targetHost must be a non-empty string");
    }
    return { listenPort, targetHost, targetPort };
  });
}

/**
 * Errors destroy both sockets rather than propagating: a browser giving up mid-request is
 * normal, and an unhandled `ECONNRESET` would take the forwarder and the whole run down.
 */
export function createForwarder(
  { listenPort, targetHost, targetPort },
  { connectTimeoutMs = CONNECT_TIMEOUT_MS, createConnection = connect } = {},
) {
  const server = createServer((incoming) => {
    const outgoing = createConnection({ host: targetHost, port: targetPort });
    const shutdown = () => {
      incoming.destroy();
      outgoing.destroy();
    };
    incoming.on("error", shutdown);
    outgoing.on("error", shutdown);
    // Node's socket timer runs during the connect too, so one timeout covers establishment
    // and is then switched off: it must never reach a connection that is merely idle.
    outgoing.setTimeout(connectTimeoutMs, () => {
      process.stderr.write(
        `loopback-forward: no connection to ${targetHost}:${String(targetPort)} within ${String(connectTimeoutMs)}ms\n`,
      );
      shutdown();
    });
    outgoing.on("connect", () => {
      outgoing.setTimeout(0);
    });
    incoming.pipe(outgoing);
    outgoing.pipe(incoming);
  });
  server.listen(listenPort, LISTEN_ADDRESS);
  return server;
}

/* c8 ignore start -- process wiring, exercised by compose-e2e.test.ts as a child process */
function main() {
  const raw = process.argv[2];
  if (raw === undefined) {
    process.stderr.write("Usage: node scripts/loopback-forward.mjs <routes-json>\n");
    process.exit(1);
  }
  const routes = parseRoutes(raw);
  // Not `routes.map(createForwarder)`: `map` would pass the index as the options argument.
  const servers = routes.map((route) => createForwarder(route));

  let pending = servers.length;
  for (const server of servers) {
    server.on("error", (error) => {
      process.stderr.write(`loopback-forward: ${error.message}\n`);
      process.exit(1);
    });
    server.on("listening", () => {
      pending -= 1;
      // The parent waits for this line, so the suite can never start against a port that is
      // not yet accepting.
      if (pending === 0) process.stdout.write("ready\n");
    });
  }

  const stop = () => {
    for (const server of servers) server.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  // The parent holds this pipe open for the run, so end-of-stream means it is gone however
  // it went, including a signal it never got to handle.
  process.stdin.on("end", stop);
  process.stdin.resume();
}

// `pathToFileURL` rather than a `file://` template: a character that percent-encodes in
// the checkout path makes the interpolated string differ from `import.meta.url`, and
// `main()` then silently never runs.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
/* c8 ignore stop */
