/**
 * The two operations screens' URL state (issue #1117).
 *
 * §7.0's table gives the responses index one filter ("Search forms") and the webhook
 * operations screen one ("form"), and both are read here rather than in the pages, for the
 * reason `lib/questions/list-filters.ts` records at length: the rail is a parallel-route
 * slot, so each of these screens is two React trees rendered from one URL, and both have to
 * agree about what the URL says. A control showing "Any form" beside a queue the render has
 * already narrowed is a screen saying two things.
 *
 * Neither function narrows anything itself. The responses index hands its term to
 * `GET /admin/forms`, which owns the matching (R2); the webhook screen's form filter is
 * applied to the queue the render read, because `GET /admin/outbox/dead-letters` is global
 * by design and takes no form parameter - the queue answers "is anything stuck", and the
 * filter is for the operator's next question rather than a different read.
 */

/** One raw search-param value, as Next hands it over. */
export type SearchParam = string | string[] | undefined;

/** The first value of a repeated param, or `undefined`. */
function firstValue(raw: SearchParam): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** What the URL says the responses index should list. */
export interface ResponsesIndexFilters {
  /** The term to match forms on. The API trims what it matches. */
  readonly search: string;
  /** How many filters are set: zero or one, for the rail's active count. */
  readonly activeCount: number;
}

/** Read the responses index's URL state. */
export function readResponsesIndexFilters(
  params: Readonly<Record<string, SearchParam>>,
): ResponsesIndexFilters {
  const search = firstValue(params["q"]) ?? "";
  return { search, activeCount: search.trim() === "" ? 0 : 1 };
}

/** What the URL says the webhook operations screen should show. */
export interface WebhookOpsFilters {
  /**
   * The form whose stuck deliveries to show, or `undefined` for every form.
   *
   * Kept as the raw string rather than validated against the form list: a form id the
   * installation does not have narrows the queue to nothing, which is the truthful answer to
   * what the address asked for, and the Form control shows the id it was given rather than
   * silently resetting to "Any form" and disagreeing with the rows beside it.
   */
  readonly formId: string | undefined;
  /** How many filters are set: zero or one, for the rail's active count. */
  readonly activeCount: number;
}

/** Read the webhook operations screen's URL state. */
export function readWebhookOpsFilters(
  params: Readonly<Record<string, SearchParam>>,
): WebhookOpsFilters {
  const raw = firstValue(params["form"]);
  const formId = raw === undefined || raw === "" ? undefined : raw;
  return { formId, activeCount: formId === undefined ? 0 : 1 };
}
