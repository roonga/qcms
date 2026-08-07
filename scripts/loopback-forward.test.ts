import { AddressInfo, connect, createConnection as netConnect } from "node:net";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { CONNECT_TIMEOUT_MS, createForwarder, parseRoutes } from "./loopback-forward.mjs";

/**
 * The forwarder's **establishment** timeout (issue #335).
 *
 * Why this is worth a test at all: the failure it exists for is the expensive one.
 * A target the forwarder cannot reach - the shape Docker's cross-bridge isolation
 * produces, where the SYN is dropped rather than refused - leaves the connect sitting
 * for the OS retry budget, over two minutes, and the run dies inside a Playwright
 * timeout that names nothing useful. Ten seconds turns that into a connection error
 * attached to the request that caused it.
 *
 * Why it is tested through an injected connection rather than a real socket: a TCP
 * connect that hangs cannot be produced deterministically from a test. Every locally
 * reachable address either connects or refuses, and the addresses that do hang
 * (blackholed routes) depend on the network the suite happens to run on, so a test
 * built on one would pass vacuously the moment an ICMP unreachable came back instead.
 * What is asserted here is exactly what this file decides: the budget it arms, that
 * firing it destroys both sides, and that a successful connect disarms it.
 */

/** A stand-in for the outgoing socket that records what the forwarder does to it. */
class FakeSocket extends PassThrough {
  timeouts: number[] = [];
  onTimeout?: () => void;
  destroyed_ = false;

  setTimeout(ms: number, callback?: () => void): this {
    this.timeouts.push(ms);
    if (callback !== undefined) this.onTimeout = callback;
    return this;
  }

  destroy(): this {
    this.destroyed_ = true;
    return super.destroy() as unknown as this;
  }
}

const openServers: { close(): void }[] = [];

afterEach(() => {
  for (const server of openServers.splice(0)) server.close();
});

/**
 * Drive one accepted connection through a forwarder on an ephemeral port, and hand
 * back the fake it was given for the outbound side.
 */
async function forwardOnce(): Promise<{
  outgoing: FakeSocket;
  client: ReturnType<typeof connect>;
}> {
  let outgoing: FakeSocket | undefined;
  const server = createForwarder(
    { listenPort: 0, targetHost: "10.0.0.1", targetPort: 3000 },
    {
      createConnection: () => {
        outgoing = new FakeSocket();
        return outgoing as unknown as ReturnType<typeof netConnect>;
      },
    },
  );
  openServers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const client = connect({ host: "127.0.0.1", port });
  await new Promise((resolve) => client.once("connect", resolve));
  // The forwarder builds the outbound side synchronously in its connection handler,
  // which has run by the time the client's own connect event has.
  if (outgoing === undefined) throw new Error("the forwarder never opened an outbound socket");
  return { outgoing, client };
}

describe("createForwarder establishment timeout", () => {
  it("arms the connect budget on the outbound socket", async () => {
    const { outgoing, client } = await forwardOnce();
    expect(outgoing.timeouts).toEqual([CONNECT_TIMEOUT_MS]);
    client.destroy();
  });

  it("destroys both sides when the target never answers", async () => {
    const { outgoing, client } = await forwardOnce();
    const clientClosed = new Promise((resolve) => client.once("close", resolve));
    outgoing.onTimeout?.();
    expect(outgoing.destroyed_).toBe(true);
    // The browser-facing side goes too, so the request fails fast instead of hanging
    // on a forwarder that will never have anything to send it.
    await clientClosed;
  });

  it("disarms it once the connection is established, so idle keep-alives survive", async () => {
    const { outgoing, client } = await forwardOnce();
    outgoing.emit("connect");
    expect(outgoing.timeouts).toEqual([CONNECT_TIMEOUT_MS, 0]);
    expect(outgoing.destroyed_).toBe(false);
    client.destroy();
  });

  it("is an establishment budget, not an idle one", () => {
    // Stated as an assertion because the value is the whole argument: anything short
    // enough to be useful as an idle timeout would kill a browser's keep-alive
    // connections between actions and read as a flaky application.
    expect(CONNECT_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
  });
});

describe("parseRoutes", () => {
  it("rejects a malformed route rather than failing at connection time", () => {
    expect(() => parseRoutes("{")).toThrow(/must be JSON/);
    expect(() => parseRoutes("[]")).toThrow(/non-empty array/);
    expect(() => parseRoutes('[{"listenPort":"x","targetHost":"h","targetPort":1}]')).toThrow(
      /must be integers/,
    );
    expect(() => parseRoutes('[{"listenPort":1,"targetHost":"","targetPort":1}]')).toThrow(
      /non-empty string/,
    );
  });
});
