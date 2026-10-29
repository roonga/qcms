import { NextResponse, type NextRequest } from "next/server";

// Relative, not the `@/` alias: Vitest resolves no Next path aliases.
import { challengeProvider } from "./lib/server/challenge";
import { buildCsp } from "./lib/server/csp";
import {
  ENVIRONMENT_HEADER,
  PROD_ENVIRONMENT,
  environmentForHost,
  nonProdEnvironments,
} from "./lib/server/environment";
import { REQUEST_ID_HEADER, normalizeRequestId } from "./lib/server/request-id";

/**
 * An unlisted first segment resolves to `prod` and is left unrewritten, so
 * `/staging/s/ses_1` gets the unprefixed route tree's own 404.
 */
function resolveEnvironment(pathname: string): { environment: string; path: string } {
  const [, first = "", ...rest] = pathname.split("/");
  if (!nonProdEnvironments().includes(first)) {
    return { environment: PROD_ENVIRONMENT, path: pathname };
  }
  return { environment: first, path: `/${rest.join("/")}` };
}

function isAnonymousEntry(path: string): boolean {
  return path === "/f" || path.startsWith("/f/");
}

function rewriteTarget(
  request: NextRequest,
  path: string,
  anonymousRefused: boolean,
): URL | undefined {
  if (anonymousRefused) return new URL("/qcms-no-such-route", request.nextUrl);
  if (path === request.nextUrl.pathname) return undefined;
  return new URL(`${path}${request.nextUrl.search}`, request.nextUrl);
}

export function proxy(request: NextRequest): NextResponse {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  const csp = buildCsp(challengeProvider(), nonce);

  const requestId =
    normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? crypto.randomUUID();

  const { environment, path } = resolveEnvironment(request.nextUrl.pathname);
  const hostEnvironment = environmentForHost(request.headers.get("host"));

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  // Overwritten rather than honoured, so a respondent cannot choose an environment by
  // sending this header (Q21).
  requestHeaders.set(ENVIRONMENT_HEADER, environment);
  // Next reads the nonce from the request CSP header to stamp its own scripts.
  requestHeaders.set("Content-Security-Policy", csp);

  // No anonymous entry to a non-prod environment, on any address or on a hostname
  // reserved for one (SEC-14). Rewritten to a path no route matches, so the answer is
  // Next's own 404 rather than a refusal this file composed (ADR-09).
  const anonymousRefused =
    isAnonymousEntry(path) && (environment !== PROD_ENVIRONMENT || hostEnvironment !== undefined);

  const rewritten = rewriteTarget(request, path, anonymousRefused);

  const response =
    rewritten === undefined
      ? NextResponse.next({ request: { headers: requestHeaders } })
      : NextResponse.rewrite(rewritten, { request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
