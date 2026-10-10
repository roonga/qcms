import { cookies } from "next/headers";

import { ENVIRONMENT_COOKIE, PROD_ENVIRONMENT } from "../environment.ts";

/**
 * The environment header every admin API call carries (ADR-40 Q6, task 065).
 *
 * The switcher's selection has to reach the API, because the API is what reads an
 * environment's data: it chooses a pool per request from this header
 * (`middleware/request-environment.ts`, mounted on the admin group alone). One place
 * assembles it - `api.ts`, the BFF's single door - so "the switcher sets the environment
 * for every screen" is one edit rather than one per screen, which is the R2 property that
 * made it cheap.
 *
 * Its own module beside `request-id.ts`, and for the same reason that one exists: `api.ts`
 * needs the value while assembling headers, and `environments.ts` - which talks to the API
 * - would be a cycle.
 */

/** The header the API's admin group reads the request's environment from. */
export const ENVIRONMENT_HEADER = "x-qcms-environment";

/**
 * The selection as the cookie holds it, or `prod`.
 *
 * **Unvalidated on purpose.** This app does not know the live set here and must not guess:
 * a name the deployment does not serve is refused by the API with a 400 naming it, which is
 * the answer an operator should get, and quietly substituting production would serve them
 * production under a banner saying `test`. A screen that holds the set validates there
 * (`environments.ts`).
 *
 * `cookies()` throws outside a request scope, which is a programming error rather than a
 * runtime condition here - every caller is a server component, a server action or a route
 * handler - but it is caught for the same reason `currentRequestId` catches: a header that
 * cannot be resolved must not take the request with it.
 */
export async function currentEnvironment(): Promise<string> {
  try {
    const raw = (await cookies()).get(ENVIRONMENT_COOKIE)?.value;
    return raw === undefined || raw === "" ? PROD_ENVIRONMENT : raw;
  } catch {
    return PROD_ENVIRONMENT;
  }
}
