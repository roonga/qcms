/**
 * The human-facing correlation id (ADR-34 P5): the token a respondent or a tester can
 * quote, which the API echoes on every response.
 *
 * `proxy.ts` is the single minting point, stamping it on the forwarded request headers,
 * from where every Server Component and route handler reads it back and the BFF puts it
 * on its API fetches. `traceparent` is the machine-readable propagation beside it, not
 * instead of it.
 */

import { headers } from "next/headers";

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * The API's own inbound limit, mirrored here so the portal never forwards a value the
 * API would silently discard.
 */
const MAX_LENGTH = 200;

export function normalizeRequestId(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > MAX_LENGTH) return undefined;
  return trimmed;
}

/**
 * Mints nothing as a fallback: one id per browser request is the point, and inventing a
 * second here would produce a different value per fetch. With no id, the API generates
 * one and still echoes it.
 */
export async function currentRequestId(): Promise<string | undefined> {
  try {
    const store = await headers();
    return normalizeRequestId(store.get(REQUEST_ID_HEADER));
  } catch {
    // `headers()` throws outside a request (a unit test, or a module-scope call).
    return undefined;
  }
}
