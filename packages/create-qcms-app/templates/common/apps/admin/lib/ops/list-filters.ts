/** Read one URL state for page and rail. Apply the form filter to the global dead-letter queue, not a guessed form-scoped API. */

export type SearchParam = string | string[] | undefined;

function firstValue(raw: SearchParam): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export interface WebhookOpsFilters {
  /** An unknown form ID legitimately matches nothing; do not discard it and show every form instead. */
  readonly formId: string | undefined;

  readonly activeCount: number;
}

export function readWebhookOpsFilters(
  params: Readonly<Record<string, SearchParam>>,
): WebhookOpsFilters {
  const raw = firstValue(params["form"]);
  const formId = raw === undefined || raw === "" ? undefined : raw;
  return { formId, activeCount: formId === undefined ? 0 : 1 };
}
