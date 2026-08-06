import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createForwarder, parseRoutes } from "./loopback-forward.mjs";

const FORWARDER = fileURLToPath(new URL("loopback-forward.mjs", import.meta.url));
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

/** A throwaway origin server that answers every connection with `token`. */
async function echoServer(token: string): Promise<{ port: number; close: () => void }> {
  const server = createServer((socket) => socket.end(token));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { port: address.port, close: () => server.close() };
}

/** Read whatever a single connection to `port` produces. */
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

/** An unused loopback port, released immediately before the forwarder claims it. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

/** Start the forwarder as a child process and wait for its `ready` line. */
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
    // A bad route would otherwise surface minutes later as a Playwright timeout,
    // where it reads exactly like an application bug.
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
    // The forwarder exists so a container can reach a loopback-published stack. If it
    // listened on 0.0.0.0 it would re-expose on every interface exactly what
    // docker-compose.yml's bind address deliberately keeps off them.
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
    // The teardown path that survives a parent killed without warning. Without it, a
    // forwarder outlives its run and holds this seat's harness ports: the orphaned
    // container class of leak, in a different shape.
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
    // Binding the same port again is the proof it was actually released.
    const rebound = createServer();
    await new Promise<void>((resolve, reject) => {
      rebound.once("error", reject);
      rebound.listen(listenPort, "127.0.0.1", resolve);
    });
    rebound.close();
    origin.close();
  });
});

describe("entry-point guard", () => {
  it("still runs main() from a path that percent-encodes", async () => {
    // The guard compares `import.meta.url` against argv[1]. Built as a `file://`
    // template it differs the moment the path holds a character that encodes - a
    // space is enough - and then `main()` silently never runs. The only symptom is
    // the parent's 30-second "forwarder did not become ready" timeout, which points
    // nowhere near the cause. `pathToFileURL` is what makes the two comparable.
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
