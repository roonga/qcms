import type { ApiGroupRoster } from "@/lib/server/api";

/**
 * The API's roster projection as the renderer's expansion wants it (task 073).
 *
 * The API sends an array so the wire has a stable order (document order of the groups,
 * roster order within each) and the renderer wants a lookup. That is the whole of this
 * module: a shape change, no decision. The portal derives nothing from a roster and
 * could not - liveness is a function of the count source and the API computes it above
 * the evaluator (ADR-42, R2).
 */
export function rosterMap(
  rosters: readonly ApiGroupRoster[],
): Readonly<Record<string, readonly string[]>> {
  const byGroup: Record<string, readonly string[]> = {};
  for (const entry of rosters) byGroup[entry.groupId] = entry.instances;
  return byGroup;
}
