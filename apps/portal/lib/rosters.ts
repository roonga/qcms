import type { ApiGroupRoster } from "@/lib/server/api";

/**
 * A shape change and no decision: the API sends an array so the wire has a stable order,
 * and the renderer's expansion wants a lookup. The portal derives nothing from a roster
 * and could not, since liveness is computed above the evaluator (ADR-42, R2).
 */
export function rosterMap(
  rosters: readonly ApiGroupRoster[],
): Readonly<Record<string, readonly string[]>> {
  const byGroup: Record<string, readonly string[]> = {};
  for (const entry of rosters) byGroup[entry.groupId] = entry.instances;
  return byGroup;
}
