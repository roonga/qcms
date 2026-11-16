/* eslint-disable no-restricted-imports -- the Node adapter at the process boundary, composed into Deps by main.ts; handlers stay Fetch-pure (R4). */
import { Resolver } from "node:dns/promises";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import tls from "node:tls";
import zlib from "node:zlib";
import type { Readable, Transform } from "node:stream";

import { refuse } from "./port.js";
import { FETCH_LIMITS } from "./policy.js";
import type {
  BrandResolver,
  BrandTransport,
  TransportRequest,
  TransportResponse,
} from "./fetcher.js";

const NO_RECORD = new Set(["ENODATA", "ENOTFOUND"]);

async function recordsOf(lookup: Promise<string[]>): Promise<string[]> {
  try {
    return await lookup;
  } catch (err: unknown) {
    if (NO_RECORD.has((err as { code?: string }).code ?? "")) return [];
    throw refuse("dns");
  }
}

/** DNS records, not `getaddrinfo`, so every A and AAAA record is seen and none is hidden by a hosts file. */
export function createDnsResolver(timeoutMs: number = FETCH_LIMITS.dnsTimeoutMs): BrandResolver {
  return {
    async resolve(host, signal) {
      const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
      const cancel = (): void => resolver.cancel();
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const [v4, v6] = await Promise.all([
          recordsOf(resolver.resolve4(host)),
          recordsOf(resolver.resolve6(host)),
        ]);
        return [...v4, ...v6];
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
  };
}

export interface NodeTransportOptions {
  /** An HTTP CONNECT proxy, which is handed the pinned address and never the host name (S2). */
  readonly proxy?: { readonly host: string; readonly port: number } | undefined;
  readonly connectTimeoutMs?: number;
  /** Test seam: the trust roots for a fixture server's certificate. Production uses the system store. */
  readonly ca?: string;
  /** Test seam: where a pinned address is dialled. Production dials the address itself on 443. */
  readonly dial?: (address: string) => { readonly host: string; readonly port: number };
}

function tlsOptions(
  request: TransportRequest,
  options: NodeTransportOptions,
): tls.ConnectionOptions {
  return {
    // Verified against this name as well as sent as SNI, so the pinned address has to
    // present a certificate for the host the user typed (F3).
    servername: request.host,
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    ALPNProtocols: ["http/1.1"],
    ...(options.ca === undefined ? {} : { ca: options.ca }),
  };
}

function secured(
  socket: tls.TLSSocket,
  request: TransportRequest,
  timeoutMs: number,
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const fail = (reason: string): void => {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onAbort);
      socket.destroy();
      reject(refuse(reason));
    };
    const onAbort = (): void => fail("timeout");
    const timer = setTimeout(() => fail("connect-timeout"), timeoutMs);
    request.signal.addEventListener("abort", onAbort, { once: true });
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onAbort);
      resolve(socket);
    });
    socket.once("error", () => fail("tls"));
  });
}

function connectTarget(address: string): string {
  return address.includes(":") ? `[${address}]:443` : `${address}:443`;
}

function openViaProxy(
  request: TransportRequest,
  options: NodeTransportOptions,
  proxy: { readonly host: string; readonly port: number },
  timeoutMs: number,
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const target = connectTarget(request.address);
    const tunnel = http.request({
      host: proxy.host,
      port: proxy.port,
      method: "CONNECT",
      path: target,
      headers: { host: target },
      agent: false,
      signal: request.signal,
    });
    // A timer rather than the `timeout` option, which would stay on the tunnelled socket
    // as an idle timeout after the handshake.
    const timer = setTimeout(() => tunnel.destroy(), timeoutMs);
    tunnel.once("connect", (response, socket) => {
      clearTimeout(timer);
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(refuse("proxy"));
        return;
      }
      const secure = tls.connect({ socket, ...tlsOptions(request, options) });
      secured(secure, request, timeoutMs).then(resolve, reject);
    });
    tunnel.once("error", () => {
      clearTimeout(timer);
      reject(refuse(request.signal.aborted ? "timeout" : "proxy"));
    });
    tunnel.end();
  });
}

function openDirect(
  request: TransportRequest,
  options: NodeTransportOptions,
  timeoutMs: number,
): Promise<tls.TLSSocket> {
  const dial = options.dial?.(request.address) ?? { host: request.address, port: 443 };
  const socket = tls.connect({ host: dial.host, port: dial.port, ...tlsOptions(request, options) });
  return secured(socket, request, timeoutMs);
}

function decoderFor(encoding: string | undefined): Transform | null | undefined {
  const value = (encoding ?? "identity").trim().toLowerCase();
  if (value === "" || value === "identity") return null;
  if (value === "gzip" || value === "x-gzip") return zlib.createGunzip();
  if (value === "deflate") return zlib.createInflate();
  if (value === "br") return zlib.createBrotliDecompress();
  return undefined;
}

/**
 * Two counters (F6): bytes off the wire before decompression and bytes decompression
 * produces, each destroying the stream the moment it passes its cap.
 */
function readBody(response: IncomingMessage, request: TransportRequest): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const declared = Number(response.headers["content-length"] ?? "0");
    if (Number.isFinite(declared) && declared > request.wireBytes) {
      response.destroy();
      reject(refuse("too-large"));
      return;
    }
    const decoder = decoderFor(response.headers["content-encoding"]);
    if (decoder === undefined) {
      response.destroy();
      reject(refuse("content-encoding"));
      return;
    }
    let settled = false;
    const fail = (reason: string): void => {
      if (settled) return;
      settled = true;
      response.destroy();
      decoder?.destroy();
      reject(refuse(reason));
    };
    let wire = 0;
    response.on("data", (chunk: Uint8Array) => {
      wire += chunk.byteLength;
      if (wire > request.wireBytes) fail("too-large");
    });
    response.once("error", () => fail(request.signal.aborted ? "timeout" : "body"));
    response.once("aborted", () => fail("body"));

    const output: Readable = decoder ?? response;
    if (decoder !== null) response.pipe(decoder);
    const chunks: Uint8Array[] = [];
    let decoded = 0;
    output.on("data", (chunk: Uint8Array) => {
      decoded += chunk.byteLength;
      if (decoded > request.decodedBytes) {
        fail("decoded-too-large");
        return;
      }
      chunks.push(chunk);
    });
    output.once("error", () => fail("decode"));
    output.once("end", () => {
      if (settled) return;
      settled = true;
      const body = new Uint8Array(decoded);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(body);
    });
  });
}

function get(socket: tls.TLSSocket, request: TransportRequest): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      // No `agent`: an agent, even `agent: false`, would open its own connection and
      // ignore this pinned one.
      createConnection: () => socket,
      method: "GET",
      path: request.path,
      setHost: false,
      maxHeaderSize: 16_384,
      insecureHTTPParser: false,
      // No cookie or credential is sent, and nothing a response sets is kept (F9).
      headers: {
        host: request.host,
        accept: request.accept,
        "accept-encoding": "gzip, deflate, br",
        "user-agent": "QCMS-theme-derive",
        connection: "close",
      },
    });
    const onAbort = (): void => {
      outgoing.destroy();
      socket.destroy();
      reject(refuse("timeout"));
    };
    request.signal.addEventListener("abort", onAbort, { once: true });
    const done = (): void => request.signal.removeEventListener("abort", onAbort);
    outgoing.once("error", () => {
      done();
      reject(refuse(request.signal.aborted ? "timeout" : "transport"));
    });
    outgoing.once("response", (response) => {
      const status = response.statusCode ?? 0;
      const head = {
        status,
        location: response.headers.location ?? null,
        contentType: response.headers["content-type"] ?? null,
      };
      if (status !== 200) {
        response.destroy();
        socket.destroy();
        done();
        resolve({ ...head, body: new Uint8Array() });
        return;
      }
      readBody(response, request).then(
        (body) => {
          done();
          socket.destroy();
          resolve({ ...head, body });
        },
        (err: unknown) => {
          done();
          socket.destroy();
          reject(err instanceof Error ? err : refuse("body"));
        },
      );
    });
    outgoing.end();
  });
}

export function createNodeTransport(options: NodeTransportOptions = {}): BrandTransport {
  const timeoutMs = options.connectTimeoutMs ?? FETCH_LIMITS.connectTimeoutMs;
  return {
    async request(request) {
      const socket =
        options.proxy === undefined
          ? await openDirect(request, options, timeoutMs)
          : await openViaProxy(request, options, options.proxy, timeoutMs);
      return get(socket, request);
    },
  };
}
