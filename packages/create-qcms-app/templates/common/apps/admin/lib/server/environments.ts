import type { EnvironmentCheck, ResolvedEnvironment } from "../environment.ts";
import { confirmEnvironment } from "../environment.ts";

import { adminApiFetch, requestEnvironment } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
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

/**
 * `GET /admin/environments` - the set a grant may name, with each row's position.
 *
 * Sent without the environment header: the set is not one environment's, and a stale
 * selection in the header would have the API refuse this read outright.
 */
export async function listEnvironments(
  session: AdminSession,
): Promise<ApiResult<readonly EnvironmentOption[]>> {
  const result = await readResult<{ environments?: unknown }>(
    await adminApiFetch(session, "/environments", { omitEnvironment: true }),
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
 * The environment this request is about, resolved once and shared with the API header
 * (local UX list A12). See `requestEnvironment` in `api.ts`, which owns it because the
 * header does.
 */
export function resolvedEnvironment(session: AdminSession): Promise<ResolvedEnvironment> {
  return requestEnvironment(session);
}

/**
 * Confirm an environment-sensitive action against the environment this request resolves
 * to (local UX list A1).
 *
 * Every such action takes `shown` as an argument the page binds, and calls this before it
 * forwards anything: a refusal carries the catalog sentence the action returns as its
 * error, and nothing reaches the API. `confirmEnvironment` holds the rule and its reasoning.
 */
export async function confirmShownEnvironment(
  session: AdminSession,
  shown: string | undefined,
): Promise<EnvironmentCheck> {
  return confirmEnvironment(shown, await requestEnvironment(session));
}
