/**
 * A loopback TCP forwarder, so the full-stack suite can browse `http://localhost`
 * from inside the dev container (issue #316).
 *
 * ## Why this exists rather than a different address
 *
 * The stack is published on the Docker host, which inside the dev container is not
 * this process (ADR-29: `docker compose` drives the mounted host socket, so every
 * service is a sibling container). The obvious repair is to browse the host's
 * gateway address instead of `localhost`, and it is wrong: a `Secure` cookie can
 * only be stored by a **trustworthy origin**. Chromium counts `http://localhost` as
 * trustworthy and a bare IPv4 gateway as not, so browsing the gateway silently drops
 * better-auth's session and two-factor cookies, and admin sign-in appears to succeed
 * and bounce. Turning `Secure` off to compensate would make the local run exercise a
 * *different cookie configuration than CI* - which, while CI is down and local green
 * is the only evidence, quietly removes the auth-boundary coverage this suite exists
 * to provide.
 *
 * So the origin stays `http://localhost:<harness port>` in every environment, and
 * this process is what makes that address real inside the container: it listens on
 * the container's own loopback and forwards to the service containers.
 *
 * ## Why it forwards to container addresses, not to a published port
 *
 * `docker-compose.yml` publishes to `${QCMS_BIND_ADDRESS:-127.0.0.1}` on purpose - a
 * bare `PORT:3000` would put the authoring admin on every network the host can
 * reach, past the host firewall - and that exposure property is not tradeable. A
 * listener on the *host's* loopback is unreachable from a sibling container whatever
 * address it dials, so the forwarder targets the service containers on the
 * Compose-created network directly. `scripts/compose-e2e.mjs` joins that network and
 * resolves the addresses; publishing is then irrelevant to how the suite connects,
 * which is exactly why the bind can be left alone.
 *
 * ## Why a separate process
 *
 * `compose-e2e.mjs` drives everything with `spawnSync`, which blocks its event loop
 * for the whole Playwright run. A listener in that process would accept nothing. So
 * the forwarder is spawned as its own process with its own event loop.
 *
 * ## Lifetime
 *
 * It exits when its **stdin closes**, which happens when the parent dies for any
 * reason including a signal it never handled, and on `SIGTERM`/`SIGINT`. The parent
 * also kills it explicitly on teardown. That is three independent paths, on purpose:
 * a forwarder that outlived its run would hold this seat's harness ports and be the
 * next orphan-container-class leak.
 *
 * Usage:  node scripts/loopback-forward.mjs '[{"listenPort":17100,"targetHost":"172.20.0.5","targetPort":3000}]'
 * Prints: one `ready` line on stdout once every listener is bound.
 */

import { connect, createServer } from "node:net";

/** Loopback only. The forwarder must never widen what Compose chose to expose. */
const LISTEN_ADDRESS = "127.0.0.1";

/**
 * @typedef {object} ForwardRoute
 * @property {number} listenPort port on this container's loopback.
 * @property {string} targetHost the service container's address.
 * @property {number} targetPort the port inside that container.
 */

/**
 * Parse and validate the route table.
 *
 * Validated rather than trusted because a malformed entry would otherwise surface as
 * a connection failure minutes later, inside a Playwright timeout, where it reads
 * like an application bug.
 *
 * @param {string} raw
 * @returns {ForwardRoute[]}
 */
export function parseRoutes(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`loopback-forward: routes must be JSON: ${String(error)}`);
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
 * One listening socket forwarding every accepted connection to one target.
 *
 * Errors on either side destroy both sockets rather than propagating: a browser that
 * gives up mid-request is completely normal, and an unhandled `ECONNRESET` here
 * would take down the forwarder and with it the rest of the run.
 *
 * @param {ForwardRoute} route
 * @returns {import("node:net").Server}
 */
export function createForwarder({ listenPort, targetHost, targetPort }) {
  const server = createServer((incoming) => {
    const outgoing = connect({ host: targetHost, port: targetPort });
    const shutdown = () => {
      incoming.destroy();
      outgoing.destroy();
    };
    incoming.on("error", shutdown);
    outgoing.on("error", shutdown);
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
  const servers = routes.map(createForwarder);

  let pending = servers.length;
  for (const server of servers) {
    server.on("error", (error) => {
      process.stderr.write(`loopback-forward: ${error.message}\n`);
      process.exit(1);
    });
    server.on("listening", () => {
      pending -= 1;
      // One line, once, after every listener is bound: the parent waits for it, so
      // the suite can never start against a port that is not yet accepting.
      if (pending === 0) process.stdout.write("ready\n");
    });
  }

  const stop = () => {
    for (const server of servers) server.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  // The parent-death path. `compose-e2e.mjs` holds this pipe open for the run, so an
  // end-of-stream means the parent is gone however it went, including a signal it
  // never got to handle. Without this the forwarder would outlive a killed run and
  // hold the seat's ports.
  process.stdin.on("end", stop);
  process.stdin.resume();
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
/* c8 ignore stop */
