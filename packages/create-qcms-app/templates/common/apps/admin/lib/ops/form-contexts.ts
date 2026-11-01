/**
 * Which of a form's operational contexts a row may open, in one environment (Q87).
 *
 * The row's `capabilities` are the cells the API decided for that form and that
 * environment, so the offer is the policy's answer rather than a role name read on this
 * side. A caller holding no read cell on a form gets no link at all: the row is on the
 * table because some operational cell admitted it, which is not the same as a screen it
 * may open.
 */

import { t } from "../i18n/en.ts";

import type { OperationsFormRow } from "./operations-forms.ts";

/** The operational contexts a form has, in the order a rail offers them. */
export const FORM_CONTEXTS = ["form", "versions", "links", "webhooks", "responses"] as const;
export type FormContext = (typeof FORM_CONTEXTS)[number];

/** The cell that admits each context, matching the route that serves it. */
const ADMITTING_CELL: Readonly<Record<FormContext, string>> = {
  form: "form:read",
  versions: "release:read",
  links: "link:read",
  webhooks: "webhook:read",
  responses: "response:read",
};

const LABEL_KEY: Readonly<Record<FormContext, Parameters<typeof t>[0]>> = {
  form: "forms.tab.builder",
  versions: "forms.tab.versions",
  links: "forms.tab.links",
  webhooks: "forms.tab.webhooks",
  responses: "forms.tab.responses",
};

export interface FormContextLink {
  readonly context: FormContext;
  readonly href: string;
  readonly label: string;
}

/** Where one context lives. The form's own screen is the subtree's root. */
export function formContextHref(formId: string, context: FormContext): string {
  const base = `/forms/${encodeURIComponent(formId)}`;
  return context === "form" ? base : `${base}/${context}`;
}

/** The contexts this row admits, in {@link FORM_CONTEXTS} order. */
export function formContextLinks(row: OperationsFormRow): readonly FormContextLink[] {
  const held = new Set(row.capabilities);
  return FORM_CONTEXTS.filter((context) => held.has(ADMITTING_CELL[context])).map((context) => ({
    context,
    href: formContextHref(row.formId, context),
    label: t(LABEL_KEY[context]),
  }));
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
