/**
 * One form's operational contexts, and which of them a caller may open (Q87).
 *
 * They live under Operations and nowhere else (Code Owner, 2026-11-02): each reads the
 * environment the shell's selection names, so opening one from the form editor would have
 * been a screen whose data belongs to a context the editor does not have. The editor keeps
 * authoring - the builder, Rules, Preview, Versions and the Publish wizard.
 *
 * The row's `capabilities` are the cells the API decided for that form and that
 * environment, so the offer is the policy's answer rather than a role name read on this
 * side. A caller holding no read cell on a form gets no link at all: the row is on the
 * table because some operational cell admitted it, which is not the same as a screen it
 * may open.
 */

import { t } from "../i18n/en.ts";

import type { OperationsFormRow } from "./operations-forms.ts";

/** The contexts a form has under Operations, in the order a rail offers them. */
export const FORM_OPERATIONAL_CONTEXTS = ["responses", "links", "webhooks"] as const;
export type FormContext = (typeof FORM_OPERATIONAL_CONTEXTS)[number];

/** The cell that admits each context, matching the route that serves it. */
const ADMITTING_CELL: Readonly<Record<FormContext, string>> = {
  responses: "response:read",
  links: "link:read",
  webhooks: "webhook:read",
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
