/** Page links carry only applied filters; unsaved toolbar edits must not alter a result set during pagination. */

/** Preserve the server-applied raw spelling; local normalization would create another interpretation of absence. */
export interface AppliedFilters {
  readonly version: string;
  readonly from: string;
  readonly to: string;
  readonly flagged: string;
  /** The address names the day zone so shared links preserve their result set; absent or unknown zones mean UTC. */
  readonly tz?: string;
}

export function responsePageLink(formId: string, filters: AppliedFilters, target: number): string {
  const search = new URLSearchParams();
  /** Name wire parameters explicitly so interface renames cannot silently change API query keys. */
  const pairs: readonly (readonly [string, string])[] = [
    ["version", filters.version],
    ["from", filters.from],
    ["to", filters.to],
    ["flagged", filters.flagged],
    ["tz", filters.tz ?? ""],
  ];
  for (const [key, value] of pairs) {
    if (value !== "") search.set(key, value);
  }
  search.set("page", String(target));
  return `/forms/${encodeURIComponent(formId)}/responses?${search.toString()}`;
}

/** Untouched date ranges retain their applied zone; edited ranges use the operator zone. Changing another filter must not reinterpret the same days on a different clock. */
export function draftDayZone(
  applied: AppliedFilters,
  draft: { readonly from: string; readonly to: string },
  operatorZone: string | null,
): string | null {
  const appliedHasDays = applied.from !== "" || applied.to !== "";
  const untouched = appliedHasDays && draft.from === applied.from && draft.to === applied.to;
  if (untouched) return applied.tz !== undefined && applied.tz !== "" ? applied.tz : "UTC";
  return operatorZone;
}
