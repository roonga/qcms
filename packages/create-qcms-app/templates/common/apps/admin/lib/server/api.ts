import { CLIENT_ADDRESS_HEADER, vouchedClientAddress } from "./client-address.ts";
import {
  ADMIN_SESSION_HEADER,
  INTERNAL_TOKEN_HEADER,
  adminBaseUrl,
  apiBaseUrl,
  internalToken,
} from "./config.ts";
import { cache } from "react";

import type { ResolvedEnvironment } from "../environment.ts";
import { headerEnvironment, resolveEnvironment } from "../environment.ts";

import type { AdminSession } from "./session.ts";
import { serverLogger } from "./logger.ts";
import {
  ENVIRONMENT_HEADER,
  environmentSelection,
  parseEnvironmentSet,
} from "./request-environment.ts";
import { REQUEST_ID_HEADER, currentRequestId } from "./request-id.ts";

/** The channel token identifies the BFF; the session token identifies the admin. Neither credential replaces the other. */

export type AdminApiPath = `/${string}`;

export interface AdminApiOptions {
  readonly method?: string;
  readonly body?: unknown;
  /** Credentials are added here; callers must not override them. */
  readonly headers?: Record<string, string>;

  readonly cache?: RequestCache;
  /** Environment discovery must omit the selection header: a stale selection would block the read needed to repair it. */
  readonly omitEnvironment?: boolean;
  /** Reuse an already-confirmed request environment in action loops; React cache does not memoize outside a render. */
  readonly environment?: string;
}

/** Non-2xx responses are returned for screen-specific handling; exports may stream the raw body. */
export async function adminApiFetch(
  session: AdminSession,
  path: AdminApiPath,
  options: AdminApiOptions = {},
): Promise<Response> {
  const requestId = await currentRequestId();
  const requestHeaders: Record<string, string> = {
    ...options.headers,
    [INTERNAL_TOKEN_HEADER]: internalToken(),
    [ADMIN_SESSION_HEADER]: session.token,
  };
  /** Use the same request resolution as the shell and confirmations. The API still validates this selection. */
  if (options.omitEnvironment !== true) {
    requestHeaders[ENVIRONMENT_HEADER] =
      options.environment ?? headerEnvironment(await requestEnvironment(session));
  }
  if (requestId !== undefined) requestHeaders[REQUEST_ID_HEADER] = requestId;
  if (options.body !== undefined) requestHeaders["content-type"] = "application/json";
  return loggedFetch(
    "api.call",
    `/admin${path.split("?")[0] ?? ""}`,
    `${apiBaseUrl()}/admin${path}`,
    {
      method: options.method ?? "GET",
      headers: requestHeaders,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      /** Admin data is never cached by default: an author who just published expects to see it. A caller that wants otherwise says so. */
      cache: options.cache ?? "no-store",
    },
    requestId,
  );
}

/** React cache shares this resolution only within a render request, never across visitors. A stale cookie resolves to prod; unreadable discovery resolves to unknown. */
export const requestEnvironment: (session: AdminSession) => Promise<ResolvedEnvironment> = cache(
  async (session: AdminSession): Promise<ResolvedEnvironment> =>
    resolveEnvironment(await environmentSelection(), await readEnvironmentSet(session)),
);

async function readEnvironmentSet(session: AdminSession): Promise<readonly string[] | undefined> {
  try {
    const response = await adminApiFetch(session, "/environments", { omitEnvironment: true });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return undefined;
    /** An object by the check above; the one field read is shape-checked by the parser. */
    return parseEnvironmentSet((body as { environments?: unknown }).environments);
  } catch {
    /** A transport failure or a truncated body is a set this app could not read, which is the `unknown` state, never a reason to fail the screen that asked. */
    return undefined;
  }
}

export type AuthApiPath = `/${string}`;

/** Forward cookies, Origin and Fetch Metadata for better-auth CSRF checks. Replace browser address claims with the trusted-hop assertion; host and content-length belong to the inbound hop. */
const FORWARDED_AUTH_HEADERS = [
  "cookie",
  "referer",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "user-agent",
  "accept-language",
  "x-forwarded-proto",
  REQUEST_ID_HEADER,
] as const;

/** No-referrer can produce Origin: null on legitimate form POSTs. Substitute this origin only after the route passes isSameOriginPost; preserve foreign origins and Fetch Metadata for better-auth to reject. */
function forwardedOrigin(from: Headers): string {
  const browserOrigin = from.get("origin");
  if (browserOrigin !== null && browserOrigin !== "" && browserOrigin !== "null") {
    return browserOrigin;
  }
  return adminBaseUrl();
}

/** Forward only the auth allowlist and the address this BFF can vouch for. */
export function authRequestHeaders(from: Headers | undefined): Headers {
  const headers = new Headers({ [INTERNAL_TOKEN_HEADER]: internalToken() });
  if (from === undefined) return headers;
  for (const name of FORWARDED_AUTH_HEADERS) {
    const value = from.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("origin", forwardedOrigin(from));
  /** Without an asserted address, better-auth uses a shared bucket, never a fresh bucket per request. */
  const address = vouchedClientAddress(from);
  if (address !== undefined) headers.set(CLIENT_ADDRESS_HEADER, address);
  return headers;
}

export interface AuthApiOptions {
  readonly method?: "GET" | "POST";

  readonly body?: unknown;

  readonly from?: Headers;
}

/** Return status and Set-Cookie unchanged so handlers can keep cookies first-party on their own 303 redirects. Auth refusals are responses; transport failures still throw. */
export function authApiFetch(path: AuthApiPath, options: AuthApiOptions = {}): Promise<Response> {
  const headers = authRequestHeaders(options.from);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return loggedFetch(
    "auth.api.call",
    `/api/auth${path}`,
    `${apiBaseUrl()}/api/auth${path}`,
    {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      /** Session reads must not survive in a cache after revocation. */
      cache: "no-store",
    },
    headers.get(REQUEST_ID_HEADER) ?? undefined,
  );
}

async function loggedFetch(
  event: "api.call" | "auth.api.call",
  path: string,
  url: string,
  init: RequestInit,
  requestId: string | undefined,
): Promise<Response> {
  const started = Date.now();
  const response = await fetch(url, init);
  serverLogger.info(event, {
    ...(requestId === undefined ? {} : { requestId }),
    method: init.method ?? "GET",
    path,
    status: response.status,
    durationMs: Date.now() - started,
  });
  return response;
}
