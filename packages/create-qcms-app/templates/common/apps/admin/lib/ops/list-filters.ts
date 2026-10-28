/**
 * The two operations screens' URL state, read in one place because each screen's page and
 * `@rail` slot are two React trees rendered from one address.
 *
 * The responses term goes to `GET /admin/forms`. The webhook form filter is applied to the
 * queue the render read, because `GET /admin/outbox/dead-letters` is global by design.
 */

/** One raw search-param value, as Next hands it over. */
export type SearchParam = string | string[] | undefined;

function firstValue(raw: SearchParam): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** What the URL says the responses index should list. */
export interface ResponsesIndexFilters {
  /** The term to match forms on. The API trims what it matches. */
  readonly search: string;
  /** Zero or one, for the rail's active count. */
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
   * The form whose stuck deliveries to show, or `undefined` for every form. Not validated
   * against the form list: an unknown id narrows the queue to nothing, which is what the
   * address asked for, and the control then agrees with the rows beside it.
   */
  readonly formId: string | undefined;
  /** Zero or one, for the rail's active count. */
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
