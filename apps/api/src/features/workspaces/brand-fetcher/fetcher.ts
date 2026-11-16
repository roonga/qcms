import { BrandFetchRefused, refuse } from "./port.js";
import type { BeforeContact, BrandFetcher, BrandResourceKind, FetchedResource } from "./port.js";
import {
  ACCEPT,
  FETCH_LIMITS,
  checkAddresses,
  checkContent,
  checkRedirect,
  checkUrl,
} from "./policy.js";

/** Every A and AAAA record of a host, both families (F2). */
export interface BrandResolver {
  resolve(host: string, signal: AbortSignal): Promise<readonly string[]>;
}

export interface TransportRequest {
  /** The name the certificate is verified against and sent as SNI and `Host`. */
  readonly host: string;
  /** The checked address the connection is made to (F3). */
  readonly address: string;
  readonly path: string;
  readonly accept: string;
  readonly wireBytes: number;
  readonly decodedBytes: number;
  readonly signal: AbortSignal;
}

export interface TransportResponse {
  readonly status: number;
  readonly location: string | null;
  readonly contentType: string | null;
  readonly body: Uint8Array;
}

/** One HTTP/1.1 GET over TLS to a pinned address; refuses with {@link BrandFetchRefused}. */
export interface BrandTransport {
  request(request: TransportRequest): Promise<TransportResponse>;
}

export interface BrandFetcherOptions {
  readonly resolver: BrandResolver;
  readonly transport: BrandTransport;
  readonly allowedHosts: readonly string[];
  readonly totalTimeoutMs?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(refuse("timeout"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(refuse("timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Carries what the contact hook threw past the catch that folds every other failure into one refusal. */
class ContactHookFailed extends Error {
  constructor(readonly failure: Error) {
    super("contact hook failed");
  }
}

async function fetchOnce(
  options: BrandFetcherOptions,
  raw: string | URL,
  kind: BrandResourceKind,
  signal: AbortSignal,
  beforeContact: BeforeContact | undefined,
): Promise<FetchedResource> {
  let target = checkUrl(raw, options.allowedHosts);
  for (let redirects = 0; ; redirects += 1) {
    if (beforeContact !== undefined) {
      await beforeContact(target.host).catch((err: unknown) => {
        throw new ContactHookFailed(
          err instanceof Error ? err : new Error("contact hook failed", { cause: err }),
        );
      });
    }
    // Resolved once per request and never again: the transport dials this address and no
    // other, so a second DNS answer cannot reach the connection (F3).
    const addresses = await abortable(options.resolver.resolve(target.host, signal), signal);
    const address = checkAddresses(addresses);
    const response = await abortable(
      options.transport.request({
        host: target.host,
        address,
        path: `${target.url.pathname}${target.url.search}`,
        accept: ACCEPT[kind],
        wireBytes: FETCH_LIMITS.wireBytes[kind],
        decodedBytes: FETCH_LIMITS.decodedBytes[kind],
        signal,
      }),
      signal,
    );
    if (REDIRECT_STATUSES.has(response.status)) {
      target = checkRedirect(target, response.location, redirects, options.allowedHosts);
      continue;
    }
    if (response.status !== 200) throw refuse("status");
    const contentType = checkContent(kind, response.contentType, response.body);
    return { url: target.url, contentType, body: response.body };
  }
}

/** SEC-18 F1 to F6 and F9 over an injected resolver and transport. */
export function createBrandFetcher(options: BrandFetcherOptions): BrandFetcher {
  return {
    async fetch(raw, kind, beforeContact) {
      const signal = AbortSignal.timeout(options.totalTimeoutMs ?? FETCH_LIMITS.totalTimeoutMs);
      try {
        return await fetchOnce(options, raw, kind, signal, beforeContact);
      } catch (err: unknown) {
        if (err instanceof ContactHookFailed) throw err.failure;
        // Whatever else failed, the caller sees one refusal (F10).
        if (err instanceof BrandFetchRefused) throw err;
        throw refuse(signal.aborted ? "timeout" : "transport");
      }
    },
  };
}
