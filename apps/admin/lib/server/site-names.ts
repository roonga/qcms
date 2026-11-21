import { SYSTEM_ACTOR } from "../site/audit.ts";

import { readAccount } from "./accounts.ts";
import type { AdminSession } from "./session.ts";

/** The most account reads one screen has in flight at once. */
export const NAME_READ_CONCURRENCY = 4;

/** Each account a screen names, by name; an id the directory no longer has is left out. */
export async function accountNames(
  session: AdminSession,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const wanted = [...new Set(ids)].filter((id) => id !== "" && id !== SYSTEM_ACTOR);
  const names = new Map<string, string>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < wanted.length) {
      const id = wanted[next];
      next += 1;
      if (id === undefined) continue;
      const result = await readAccount(session, id);
      if (result.ok) names.set(id, result.data.name === "" ? result.data.email : result.data.name);
    }
  };
  await Promise.all(Array.from({ length: Math.min(NAME_READ_CONCURRENCY, wanted.length) }, worker));
  return names;
}
