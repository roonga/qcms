import { SYSTEM_ACTOR } from "../site/audit.ts";

import { readAccount } from "./accounts.ts";
import type { AdminSession } from "./session.ts";

/** Each account a screen names, by name; an id the directory no longer has is left out. */
export async function accountNames(
  session: AdminSession,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const wanted = [...new Set(ids)].filter((id) => id !== "" && id !== SYSTEM_ACTOR);
  const read = await Promise.all(wanted.map((id) => readAccount(session, id)));
  const names = new Map<string, string>();
  for (const [index, result] of read.entries()) {
    const id = wanted[index];
    if (id === undefined || !result.ok) continue;
    names.set(id, result.data.name === "" ? result.data.email : result.data.name);
  }
  return names;
}
