// A row's `capabilities` are the cells the API decided for that form and environment, so
// the links below are the policy's answer and never a role name read on this side.

import { t } from "../i18n/en.ts";

import type { OperationsFormRow } from "./operations-forms.ts";

/** The contexts a form has under Operations, in the order a rail offers them. */
export const FORM_OPERATIONAL_CONTEXTS = ["responses", "links", "webhooks", "intake"] as const;
export type FormContext = (typeof FORM_OPERATIONAL_CONTEXTS)[number];

/**
 * The cell that admits each context, matching the route that serves it.
 *
 * Intake takes `form: read` and not `form: close`. Every context here is a READ: that
 * screen states what the selected environment serves and whether it is taking responses,
 * and the two acts beside that state carry their own `form: close` check at the API.
 * Admitting on the write would hide the reading from everyone who may not change it.
 */
const ADMITTING_CELL: Readonly<Record<FormContext, string>> = {
  responses: "response:read",
  links: "link:read",
  webhooks: "webhook:read",
  intake: "form:read",
};

export interface FormContextLink {
  readonly context: FormContext;
  readonly href: string;
  readonly label: string;
}

/** Where one context lives. */
export function formContextHref(formId: string, context: FormContext): string {
  return `/operations/forms/${encodeURIComponent(formId)}/${context}`;
}

/** The contexts this row admits, in {@link FORM_OPERATIONAL_CONTEXTS} order. */
export function formContextLinks(row: OperationsFormRow): readonly FormContextLink[] {
  const held = new Set(row.capabilities);
  return FORM_OPERATIONAL_CONTEXTS.filter((context) => held.has(ADMITTING_CELL[context])).map(
    (context) => ({
      context,
      href: formContextHref(row.formId, context),
      label: t(`forms.tab.${context}`),
    }),
  );
}

/**
 * The context a row's name opens, or `undefined` when the caller may open none of them.
 *
 * An eraser without a viewer grant is the row with no primary: its journey is a known
 * target rather than a screen that lists anything, so a name that led to a refusal would
 * be worse than a name that is not a link.
 */
export function primaryFormContext(row: OperationsFormRow): FormContextLink | undefined {
  return formContextLinks(row)[0];
}
