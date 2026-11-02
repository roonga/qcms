/** SEC-1 permits breach-corpus feedback; every other authentication failure stays opaque. */

/** Wire contract shared with the API without importing across deployables. */
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- an error code on the wire, not a credential
export const PASSWORD_COMPROMISED_CODE = "PASSWORD_COMPROMISED";

/** Which message the change-password surface renders for a refusal. */
export type PasswordRefusal = "compromised" | "generic";

/**
 * Read a refusal body and decide which sentence it earns.
 *
 * Total over unknown input, and generic for everything it does not recognise. That
 * direction is the safe one and it is the direction SEC-1 asks for: a body this cannot
 * parse, a code it has never seen, a proxy's HTML error page, all fall back to the
 * message that distinguishes nothing. Only the exact ruled code opts out.
 */
export function passwordRefusalOf(body: unknown): PasswordRefusal {
  if (typeof body !== "object" || body === null) return "generic";
  const { code } = body as { code?: unknown };
  return code === PASSWORD_COMPROMISED_CODE ? "compromised" : "generic";
}

/**
 * The same decision, over the `Response` the API's better-auth mount hands back.
 *
 * The mount forwards `auth.handler`'s own response, so the body arrives as the library
 * wrote it: `{ code, message }` at the top level. A body that is not JSON is swallowed
 * rather than thrown, because a refusal that cannot be parsed still has to render a
 * message, and the generic one is always a true thing to say.
 *
 * Only ever called on a response already known to be a refusal, so it never consumes the
 * body of a success whose `Set-Cookie` headers the caller still needs.
 */
export async function passwordRefusalFrom(response: Response): Promise<PasswordRefusal> {
  const body: unknown = await response.json().catch(() => undefined);
  return passwordRefusalOf(body);
}
