import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import https from "node:https";
import net from "node:net";
import type { AddressInfo } from "node:net";

import { generate } from "selfsigned";

import { createBrandFetcher } from "../../src/features/workspaces/brand-fetcher/fetcher.js";
import type { BrandResolver } from "../../src/features/workspaces/brand-fetcher/fetcher.js";
import { createNodeTransport } from "../../src/features/workspaces/brand-fetcher/node-transport.js";
import type { BrandFetcher } from "../../src/features/workspaces/brand-fetcher/port.js";

/** The names the fixture certificate covers. Any other name fails verification. */
export const FIXTURE_HOSTS = [
  "brand.example",
  "www.brand.example",
  "cdn.brand.example",
  "other-site.example",
] as const;

/** Public-range addresses the fixture resolver answers with; the dialler sends all of them to the server. */
export const FIXTURE_PUBLIC_ADDRESS = "93.184.215.14";
export const FIXTURE_PUBLIC_ADDRESS_V6 = "2606:2800:21f:cb07:6820:80da:af6b:8b2c";

export interface RecordedRequest {
  readonly host: string | undefined;
  readonly path: string;
  readonly cookie: string | undefined;
  readonly authorization: string | undefined;
}

export type FixtureHandler = (request: IncomingMessage, response: ServerResponse) => void;

export interface BrandFixtureServer {
  readonly port: number;
  /** The fixture certificate, to trust in place of the system store. */
  readonly ca: string;
  readonly requests: RecordedRequest[];
  /** The `CONNECT` targets the fixture proxy was asked for. */
  readonly connectTargets: string[];
  readonly proxyPort: number;
  /** Serves `handler` at `host` + `path`; a request matching none answers 404. */
  route(host: string, path: string, handler: FixtureHandler): void;
  reset(): void;
  close(): Promise<void>;
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

/**
 * A local HTTPS origin for the derive, with a certificate for {@link FIXTURE_HOSTS}, and a
 * CONNECT proxy in front of it. Every address a fetcher dials lands on the one server.
 */
export async function startBrandFixtureServer(): Promise<BrandFixtureServer> {
  const pems = await generate([{ name: "commonName", value: "brand.example" }], {
    keyType: "ec",
    curve: "P-256",
    extensions: [
      { name: "basicConstraints", cA: true },
      { name: "keyUsage", digitalSignature: true, keyCertSign: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: FIXTURE_HOSTS.map((value) => ({ type: 2 as const, value })),
      },
    ],
  });
  const routes = new Map<string, FixtureHandler>();
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket): void => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  const requests: RecordedRequest[] = [];
  const connectTargets: string[] = [];

  const server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    const host = req.headers.host;
    const path = req.url ?? "/";
    requests.push({
      host,
      path,
      cookie: req.headers.cookie,
      authorization: req.headers.authorization,
    });
    const handler = routes.get(`${host ?? ""}${path}`);
    if (handler === undefined) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    handler(req, res);
  });
  server.on("connection", track);
  const port = await listen(server);

  const proxy = http.createServer((_req, res) => res.writeHead(405).end());
  proxy.on("connect", (req: IncomingMessage, client: net.Socket) => {
    connectTargets.push(req.url ?? "");
    track(client);
    const upstream = net.connect(port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  proxy.on("connection", track);
  const proxyPort = await listen(proxy);

  return {
    port,
    ca: pems.cert,
    requests,
    connectTargets,
    proxyPort,
    route(host, path, handler) {
      routes.set(`${host}${path}`, handler);
    },
    reset() {
      routes.clear();
      requests.length = 0;
      connectTargets.length = 0;
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => proxy.close(() => resolve())),
      ]);
    },
  };
}

/** Answers every fixture host with the public fixture address, and records each question. */
export function fixtureResolver(
  answers: (host: string, call: number) => readonly string[] = () => [FIXTURE_PUBLIC_ADDRESS],
): BrandResolver & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    resolve(host) {
      calls.push(host);
      return Promise.resolve(answers(host, calls.filter((h) => h === host).length));
    },
  };
}

export interface FixtureFetcherOptions {
  readonly resolver?: BrandResolver;
  readonly allowedHosts?: readonly string[];
  readonly viaProxy?: boolean;
  readonly totalTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  /** Every address dialled, in order. */
  readonly dialled?: string[];
}

/** The real fetcher and the real Node transport, pointed at the fixture server. */
export function fixtureBrandFetcher(
  fixture: BrandFixtureServer,
  options: FixtureFetcherOptions = {},
): BrandFetcher {
  return createBrandFetcher({
    resolver: options.resolver ?? fixtureResolver(),
    allowedHosts: options.allowedHosts ?? [],
    ...(options.totalTimeoutMs === undefined ? {} : { totalTimeoutMs: options.totalTimeoutMs }),
    transport: createNodeTransport({
      ca: fixture.ca,
      ...(options.connectTimeoutMs === undefined
        ? {}
        : { connectTimeoutMs: options.connectTimeoutMs }),
      ...(options.viaProxy === true
        ? { proxy: { host: "127.0.0.1", port: fixture.proxyPort } }
        : {
            dial: (address: string) => {
              options.dialled?.push(address);
              return { host: "127.0.0.1", port: fixture.port };
            },
          }),
    }),
  });
}
