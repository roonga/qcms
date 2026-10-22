/**
 * The response browser's page links (task 035).
 *
 * ## Why this is a module and not a closure in the component
 *
 * A page link must carry the filter set the server **applied**, never the draft the
 * filter controls are holding. Built from the controls, a date typed into "From" and
 * never applied rode along with a "Next page" click: the result set changed for two
 * reasons and the operator had asked for one, while the total and the page number they
 * had just read no longer described anything.
 *
 * Fixing that inside the component means reading the right one of two things that are
 * both in scope, which is a convention. Here there is only one: the function takes the
 * applied set as an argument and the draft state does not exist in this file, so the
 * defect is unreachable rather than merely corrected. It also makes the rule testable
 * without a browser, which pagination past page 1 otherwise is not (the page size is
 * 50, so pinning it in e2e would mean seeding 51 submissions for one assertion).
 */

/**
 * The filter set as the **server** parsed it out of the querystring.
 *
 * Every value is the raw querystring string, `""` meaning absent, because that is what
 * the page hands the component and re-normalizing it here would be a second opinion
 * about what "no version" means.
 */
export interface AppliedFilters {
  readonly version: string;
  readonly from: string;
  readonly to: string;
  readonly flagged: string;
  /**
   * The IANA zone the two days are whole days IN (Code Owner, 2026-10-19), "" when the
   * address named none or an unknown one, which reads as UTC. Optional because it is not a
   * filter: it changes what `from` and `to` mean, never which filters are applied.
   */
  readonly tz?: string;
}

/**
 * A link to another page of the result set currently on screen.
 *
 * `page` is always written, including for page 1: the link is a statement of where it
 * goes, and an operator who lands on it from a "Previous page" click and then reloads
 * should get the page they were on rather than an implicit default.
 */
export function responsePageLink(formId: string, filters: AppliedFilters, target: number): string {
  const search = new URLSearchParams();
  // Named pairs rather than `Object.entries`: the querystring keys are the API's
  // contract (`?version=&from=&to=&flagged=`) and writing them out is what keeps a
  // later rename of a field in this interface from silently changing the request.
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

/**
 * The zone a DRAFT day range is read in, and therefore the one its hint names and the one
 * Apply or Export writes as `tz` (review of PR #1077).
 *
 * - **An applied range the operator has not touched keeps the zone it was applied in.**
 *   That is `applied.tz`, or UTC when the address named none or an unknown one, because
 *   UTC is what `parseResponseQuery` widened it in. So a legacy `?from=2026-07-01` is
 *   labelled UTC rather than the reader's zone, and a range a Los Angeles colleague shared
 *   stays Los Angeles when a Sydney operator changes only Version or Flagged and presses
 *   Apply, or exports the same range. Silently re-reading the days on another clock would
 *   change the result set behind an unchanged control.
 * - **A range the operator has changed, or a new one, is read on their own clock**, the
 *   one the rows are shown on. The hint moves as soon as a day changes, so the switch is
 *   visible before it is applied. There is no separate zone control: clearing and picking
 *   the days again is how an operator re-reads a shared range on their own clock.
 *
 * `null` while the operator's zone is not yet known (the server render and hydration's
 * first pass), and only in the second case.
 */
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
