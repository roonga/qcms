import { PROD_ENVIRONMENT, parseEnvironment } from "../environment.ts";

import { adminApiFetch } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import { currentEnvironment } from "./request-environment.ts";
import type { AdminSession } from "./session.ts";

/**
 * The live environment set, and which one this request is for (ADR-40 Q6, task 065).
 *
 * The set is the **API's** answer, read from `GET /admin/environments`, which reads
 * `control.environments`: that table is the source of the set, and an environment an
 * operator created last week has to appear in the switcher without anybody editing this
 * app (R2 - this app holds credentials, not authority). The admin does not know the
 * environment names and must not: a compiled-in pair here would be the "configurable set"
 * ADR-40 chose turning back into a literal on the one screen an operator uses.
 */

/** One environment of the live set, in canonical `position` order (Q42). */
export interface EnvironmentOption {
  readonly name: string;
  readonly position: number;
}

/** `GET /admin/environments` - the set the switcher offers and a release may name. */
export async function listEnvironments(
  session: AdminSession,
): Promise<ApiResult<readonly EnvironmentOption[]>> {
  const result = await readResult<{ environments?: unknown }>(
    await adminApiFetch(session, "/environments"),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseEnvironments(result.data.environments) };
}

/** Shape-check the list, dropping anything that is not an environment row. */
function parseEnvironments(value: unknown): readonly EnvironmentOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as { name?: unknown; position?: unknown };
    if (typeof row.name !== "string" || typeof row.position !== "number") return [];
    return [{ name: row.name, position: row.position }];
  });
}

/**
 * The environment this request is about: the operator's selection, or `prod`.
 *
 * Read from the cookie and **validated against the live set** when one is supplied, so a
 * stale selection - an environment dropped last week, or one left by another deployment on
 * the same host - falls through to production rather than being carried into a request the
 * API will refuse on every screen.
 *
 * The two readers know different things, which is why there are two. `adminApiFetch` has
 * no session and no list while it assembles headers, so `currentEnvironment` sends what the
 * cookie says and lets the API refuse an unknown name with a 400 - the refusal an operator
 * should see, rather than this app serving them production under a banner saying otherwise.
 * A screen that has read the set passes it here, and gets a name it can render.
 */
export async function selectedEnvironment(available: readonly string[]): Promise<string> {
  return parseEnvironment(await currentEnvironment(), available) ?? PROD_ENVIRONMENT;
}
