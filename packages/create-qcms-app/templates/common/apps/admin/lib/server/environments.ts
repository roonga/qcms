import type { EnvironmentCheck, ResolvedEnvironment } from "../environment.ts";
import { confirmEnvironment } from "../environment.ts";

import { adminApiFetch, requestEnvironment } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/** Discover the live set from the API; compiled-in names would exclude environments created without rebuilding this app. */

export interface EnvironmentOption {
  readonly name: string;
  readonly position: number;
}

/** Omit the environment header: a stale selection must not block discovery of the live set. */
export async function listEnvironments(
  session: AdminSession,
): Promise<ApiResult<readonly EnvironmentOption[]>> {
  const result = await readResult<{ environments?: unknown }>(
    await adminApiFetch(session, "/environments", { omitEnvironment: true }),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseEnvironments(result.data.environments) };
}

function parseEnvironments(value: unknown): readonly EnvironmentOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as { name?: unknown; position?: unknown };
    if (typeof row.name !== "string" || typeof row.position !== "number") return [];
    return [{ name: row.name, position: row.position }];
  });
}

/** Share requestEnvironment with API headers so chrome and actions resolve the same selection. */
export function resolvedEnvironment(session: AdminSession): Promise<ResolvedEnvironment> {
  return requestEnvironment(session);
}

/** Confirm the environment bound by the page before forwarding an environment-sensitive action; a changed tab selection must not retarget it. */
export async function confirmShownEnvironment(
  session: AdminSession,
  shown: string | undefined,
): Promise<EnvironmentCheck> {
  return confirmEnvironment(shown, await requestEnvironment(session));
}
