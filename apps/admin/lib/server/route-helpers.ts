import { adminBaseUrl } from "./config.ts";
import { logOriginBeltRefusal } from "./origin-belt-log.ts";

/** Plain form POSTs keep credentials out of client JavaScript and make authentication work before hydration. */

/** 303 makes the follow-up a GET so reload cannot resubmit credentials. Location must remain app-relative and independent of request input. */
export function redirectAfterPost(
  path: `/${string}`,
  setCookies: readonly string[] = [],
): Response {
  const headers = new Headers({ location: path });
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/** better-auth asResponse changes failures into 4xx Responses; checking only thrown APIError would treat refusals as success. */
export function authRefused(response: Response): boolean {
  return !response.ok;
}

export function authThrottled(response: Response): boolean {
  return response.status === 429;
}

/** Use getSetCookie: get("set-cookie") comma-folds independent cookies and breaks multi-cookie auth redirects. */
export function cookiesFrom(response: Response): string[] {
  return response.headers.getSetCookie();
}

/** Require same-origin Fetch Metadata or matching Origin; missing evidence fails closed. Check metadata first because no-referrer navigation POSTs can carry Origin: null. Log only refusal classifications, never header values. */
export function isSameOriginPost(request: Request): boolean {
  const allowed = admitsAsSameOrigin(request);
  if (!allowed) logOriginBeltRefusal(request);
  return allowed;
}

/** Keep the decision pure so the wrapper emits exactly one refusal log regardless of branch. */
function admitsAsSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite === "same-origin" || fetchSite === "none";
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  return origin === adminBaseUrl();
}

export function formField(form: FormData, name: string): string | undefined {
  const raw = form.get(name);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Settings needs separate markers for its two forms, but every pair maps to the same opaque failure vocabulary. */
export type FailureMarker = "error" | "throttled" | "codesError" | "codesThrottled";

/** Use opaque markers, never library messages: unknown email and wrong password must remain indistinguishable. A throttle says the credential was not judged. */
export function redirectWithGenericFailure(
  path: `/${string}`,
  marker: FailureMarker = "error",
): Response {
  return redirectAfterPost(`${path}?${marker}=1`);
}

/** Breach-corpus feedback is deliberately specific and stays outside the generic authentication marker vocabulary. */
export function redirectWithCompromisedPassword(path: `/${string}`): Response {
  return redirectAfterPost(`${path}?compromised=1`);
}

/** A mismatch discloses only the two submitted new-password values, never account state; keep it outside opaque authentication failures. */
export function redirectWithPasswordMismatch(path: `/${string}`): Response {
  return redirectAfterPost(`${path}?mismatch=1`);
}
