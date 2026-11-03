import { cookies } from "next/headers";

import { ENVIRONMENT_COOKIE } from "../environment.ts";

/** Resolve the selection against the live API set once per request and share it with chrome and headers; this pure module must not import api.ts back. */

export const ENVIRONMENT_HEADER = "x-qcms-environment";

/** The raw cookie is not validated until the API live set is available. An unavailable request scope must not fail the whole request. */
export async function environmentSelection(): Promise<string | undefined> {
  try {
    const raw = (await cookies()).get(ENVIRONMENT_COOKIE)?.value;
    return raw === undefined || raw === "" ? undefined : raw;
  } catch {
    return undefined;
  }
}

/** Preserve API position order rather than inventing local ordering. */
export function parseEnvironmentSet(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as { name?: unknown; position?: unknown };
    if (typeof row.name !== "string" || typeof row.position !== "number") return [];
    return [row.name];
  });
}
