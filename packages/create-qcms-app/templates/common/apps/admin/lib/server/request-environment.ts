import { cookies } from "next/headers";

import { ENVIRONMENT_COOKIE } from "../environment.ts";

/**
 * The environment header every admin API call carries (ADR-40 Q6, task 065), and the two
 * inputs its value is resolved from.
 *
 * The switcher's selection has to reach the API, because the API is what reads an
 * environment's data: it chooses a pool per request from this header
 * (`middleware/request-environment.ts`, mounted on the admin group alone). One place
 * assembles it - `api.ts`, the BFF's single door - so "the switcher sets the environment
 * for every screen" is one edit rather than one per screen, which is the R2 property that
 * made it cheap.
 *
 * Since local UX list A12 the header no longer carries the raw cookie. `api.ts` resolves
 * the selection against the live set once per request (`requestEnvironment`), and that one
 * answer is both what the header names and what the shell renders, so the screen and the
 * API can no longer disagree about which environment a request is for. This module holds
 * the parts of that resolution that do not talk to the API, which is why it is its own
 * module: `api.ts` imports it, and it must not import `api.ts` back.
 */

/** The header the API's admin group reads the request's environment from. */
export const ENVIRONMENT_HEADER = "x-qcms-environment";

/**
 * The selection as the cookie holds it, or `undefined` for none.
 *
 * Unvalidated here: validation is against the live set, and the set is `api.ts`'s to read.
 *
 * `cookies()` throws outside a request scope, which is a programming error rather than a
 * runtime condition here - every caller is a server component, a server action or a route
 * handler - but it is caught for the same reason `currentRequestId` catches: a header that
 * cannot be resolved must not take the request with it.
 */
export async function environmentSelection(): Promise<string | undefined> {
  try {
    const raw = (await cookies()).get(ENVIRONMENT_COOKIE)?.value;
    return raw === undefined || raw === "" ? undefined : raw;
  } catch {
    return undefined;
  }
}

/**
 * The names in a `GET /admin/environments` body, in the order the API sent them.
 *
 * Shape-checked, dropping anything that is not an environment row. The API sends the set
 * in canonical `position` order (Q42), so the order is kept rather than re-sorted here.
 */
export function parseEnvironmentSet(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as { name?: unknown; position?: unknown };
    if (typeof row.name !== "string" || typeof row.position !== "number") return [];
    return [row.name];
  });
}
