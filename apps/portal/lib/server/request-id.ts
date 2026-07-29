/**
 * The human-facing correlation id, portal side (task 054, ADR-34 P5).
 *
 * `x-request-id` is the token a respondent or a tester can quote: the API echoes
 * it on every response and puts it in the error envelope (task 017). Until now the
 * portal never forwarded it, so the browser -> portal -> API hop was uncorrelated
 * and a reported failure meant eyeballing two log streams.
 *
 * The chain is: `proxy.ts` mints one per browser request (honouring an inbound
 * one) and stamps it on the forwarded request headers -> every Server Component
 * and route handler can read it back through `headers()` -> the BFF puts it on its
 * API fetches -> the API honours it rather than generating its own. `traceparent`
 * is the machine-readable propagation beside it, not instead of it.
 */

import { headers } from "next/headers";

/** The wire name, identical on both sides of the BFF hop. */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * The API accepts an inbound id up to 200 characters and otherwise generates its
 * own (`apps/api/src/middleware/request-logger.ts`). Mirrored here so the portal
 * never forwards a value the API would silently discard.
 */
const MAX_LENGTH = 200;

/** A usable id, or `undefined` when there is nothing worth forwarding. */
export function normalizeRequestId(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > MAX_LENGTH) return undefined;
  return trimmed;
}

/**
 * This request's correlation id, or `undefined` outside a request scope.
 *
 * Deliberately does NOT mint one as a fallback: the proxy is the single minting
 * point (one id per browser request, shared by every API call that request makes),
 * and inventing a second id here would produce a different value per fetch -
 * exactly the uncorrelated state this replaces. With no id, the API generates one
 * and still echoes it, which is the pre-054 behaviour.
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
