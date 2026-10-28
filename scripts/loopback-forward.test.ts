import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AddressInfo, type Socket, connect, createServer } from "node:net";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CONNECT_TIMEOUT_MS, createForwarder, parseRoutes } from "./loopback-forward.mjs";

const FORWARDER = fileURLToPath(new URL("loopback-forward.mjs", import.meta.url));
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

async function echoServer(token: string): Promise<{ port: number; close: () => void }> {
  const server = createServer((socket) => socket.end(token));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { port: address.port, close: () => server.close() };
}

async function fetchToken(port: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port, timeout: 5000 });
    let data = "";
    socket.on("data", (chunk) => (data += chunk.toString()));
    socket.on("end", () => resolve(data));
    socket.on("timeout", () => reject(new Error("timeout")));
    socket.on("error", reject);
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function startChild(routes: unknown): Promise<ChildProcess> {
  const child = spawn(process.execPath, [FORWARDER, JSON.stringify(routes)], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("forwarder never became ready")), 10_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (!chunk.toString().includes("ready")) return;
      clearTimeout(timer);
      resolve();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`forwarder exited early (${String(code)})`));
    });
  });
  return child;
}

describe("parseRoutes", () => {
  it("rejects malformed input rather than failing later inside a browser timeout", () => {
    expect(() => parseRoutes("not json")).toThrow("must be JSON");
    expect(() => parseRoutes("[]")).toThrow("non-empty array");
    expect(() => parseRoutes('[{"listenPort":"x","targetHost":"h","targetPort":1}]')).toThrow(
      "must be integers",
    );
    expect(() => parseRoutes('[{"listenPort":1,"targetHost":"","targetPort":1}]')).toThrow(
      "non-empty string",
    );
  });

  it("accepts a well-formed route table", () => {
    expect(
      parseRoutes('[{"listenPort":17100,"targetHost":"172.20.0.5","targetPort":3000}]'),
    ).toEqual([{ listenPort: 17100, targetHost: "172.20.0.5", targetPort: 3000 }]);
  });
});

describe("createForwarder", () => {
  it("carries bytes from the loopback listener to the target", async () => {
    const origin = await echoServer("from-the-container");
    const listenPort = await freePort();
    const server = createForwarder({
      listenPort,
      targetHost: "127.0.0.1",
      targetPort: origin.port,
    });
    await new Promise<void>((resolve) => server.on("listening", resolve));
    expect(await fetchToken(listenPort)).toBe("from-the-container");
    server.close();
    origin.close();
  });

  it("binds loopback only, never widening what Compose chose to expose", async () => {
    // Listening on 0.0.0.0 would re-expose on every interface what the compose bind
    // address deliberately keeps off them.
    const origin = await echoServer("x");
    const listenPort = await freePort();
    const server = createForwarder({
      listenPort,
      targetHost: "127.0.0.1",
      targetPort: origin.port,
    });
    await new Promise<void>((resolve) => server.on("listening", resolve));
    const address = server.address();
    expect(address !== null && typeof address !== "string" && address.address).toBe("127.0.0.1");
    server.close();
    origin.close();
  });
});

describe("forwarder lifetime", () => {
  it("exits when its stdin closes, which is how it notices the parent died", async () => {
    // Without this path a forwarder outlives its run and holds this seat's harness ports.
    const origin = await echoServer("x");
    const child = await startChild([
      { listenPort: await freePort(), targetHost: "127.0.0.1", targetPort: origin.port },
    ]);
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    child.stdin?.end();
    expect(await exited).toBe(0);
    origin.close();
  });

  it("exits on SIGTERM, which is the parent's explicit teardown", async () => {
    const origin = await echoServer("x");
    const child = await startChild([
      { listenPort: await freePort(), targetHost: "127.0.0.1", targetPort: origin.port },
    ]);
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    child.kill("SIGTERM");
    await exited;
    expect(child.killed).toBe(true);
    origin.close();
  });

  it("releases its port on exit, so a later run can bind it", async () => {
    const origin = await echoServer("x");
    const listenPort = await freePort();
    const child = await startChild([
      { listenPort, targetHost: "127.0.0.1", targetPort: origin.port },
    ]);
    const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
    child.stdin?.end();
    await exited;
    const rebound = createServer();
    await new Promise<void>((resolve, reject) => {
      rebound.once("error", reject);
      rebound.listen(listenPort, "127.0.0.1", resolve);
    });
    rebound.close();
    origin.close();
  });
});

/**
 * Driven through an injected connection rather than a real socket: a TCP connect that
 * hangs cannot be produced deterministically, and a test built on a blackholed route
 * would pass vacuously the moment an ICMP unreachable came back instead.
 */

class FakeSocket extends PassThrough {
  timeouts: number[] = [];
  onTimeout?: () => void;
  wasDestroyed = false;

  setTimeout(ms: number, callback?: () => void): this {
    this.timeouts.push(ms);
    if (callback !== undefined) this.onTimeout = callback;
    return this;
  }

  destroy(): this {
    this.wasDestroyed = true;
    super.destroy();
    return this;
  }
}

describe("createForwarder establishment timeout", () => {
  const servers: { close: () => void }[] = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  async function forwardOnce(): Promise<{ outgoing: FakeSocket; client: Socket }> {
    let outgoing: FakeSocket | undefined;
    const server = createForwarder(
      { listenPort: 0, targetHost: "10.0.0.1", targetPort: 3000 },
      {
        createConnection: () => {
          outgoing = new FakeSocket();
          return outgoing as unknown as Socket;
        },
      },
    );
    servers.push(server);
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const client = connect({ host: "127.0.0.1", port });
    await new Promise((resolve) => client.once("connect", resolve));
    // The outbound side is built synchronously in the connection handler, so it has run
    // by the time the client's own connect event has.
    if (outgoing === undefined) throw new Error("the forwarder never opened an outbound socket");
    return { outgoing, client };
  }

  it("arms the connect budget on the outbound socket", async () => {
    const { outgoing, client } = await forwardOnce();
    expect(outgoing.timeouts).toEqual([CONNECT_TIMEOUT_MS]);
    client.destroy();
  });

  it("destroys both sides when the target never answers", async () => {
    const { outgoing, client } = await forwardOnce();
    const clientClosed = new Promise((resolve) => client.once("close", resolve));
    outgoing.onTimeout?.();
    expect(outgoing.wasDestroyed).toBe(true);
    await clientClosed;
  });

  it("disarms it once the connection is established, so idle keep-alives survive", async () => {
    const { outgoing, client } = await forwardOnce();
    outgoing.emit("connect");
    expect(outgoing.timeouts).toEqual([CONNECT_TIMEOUT_MS, 0]);
    expect(outgoing.wasDestroyed).toBe(false);
    client.destroy();
  });

  it("is an establishment budget, not an idle one", () => {
    // Anything short enough to be useful as an idle timeout would kill a browser's
    // keep-alive connections between actions and read as a flaky application.
    expect(CONNECT_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
  });
});

describe("entry-point guard", () => {
  it("still runs main() from a path that percent-encodes", async () => {
    // `pathToFileURL` is what makes the two comparable: a hand-built `file://` template
    // differs as soon as the path holds a character that encodes, and `main()` then
    // silently never runs.
    const directory = mkdtempSync(join(tmpdir(), "qcms forward "));
    const copied = join(directory, "loopback-forward.mjs");
    copyFileSync(FORWARDER, copied);
    const origin = await echoServer("through-a-spaced-path");
    const listenPort = await freePort();
    const routes = [{ listenPort, targetHost: "127.0.0.1", targetPort: origin.port }];
    const child = spawn(process.execPath, [copied, JSON.stringify(routes)], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("main() never ran")), 10_000);
      child.stdout?.on("data", (chunk: Buffer) => {
        if (!chunk.toString().includes("ready")) return;
        clearTimeout(timer);
        resolve();
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`exited early (${String(code)})`));
      });
    });
    expect(await fetchToken(listenPort)).toBe("through-a-spaced-path");
    origin.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
