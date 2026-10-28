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
