// A row's `capabilities` are the cells the API decided for that form and environment, so
// the links below are the policy's answer and never a role name read on this side.

import { t } from "../i18n/en.ts";

import type { OperationsFormRow } from "./operations-forms.ts";

/** The contexts a form has under Operations, in the order a rail offers them. */
export const FORM_OPERATIONAL_CONTEXTS = [
  "responses",
  "links",
  "webhooks",
  "intake",
  "erase",
] as const;
export type FormContext = (typeof FORM_OPERATIONAL_CONTEXTS)[number];

/**
 * The cell that admits each context. Intake takes `form: read`, not the `form: close` its
 * acts carry, so a reader who may not change it still sees it. Erase is the act itself.
 */
const ADMITTING_CELL: Readonly<Record<FormContext, string>> = {
  responses: "response:read",
  links: "link:read",
  webhooks: "webhook:read",
  intake: "form:read",
  erase: "response:erase",
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

/** The contexts these cells admit, in {@link FORM_OPERATIONAL_CONTEXTS} order. */
export function heldFormContexts(capabilities: readonly string[]): readonly FormContext[] {
  const held = new Set(capabilities);
  return FORM_OPERATIONAL_CONTEXTS.filter((context) => held.has(ADMITTING_CELL[context]));
}

/** The contexts this row admits, in {@link FORM_OPERATIONAL_CONTEXTS} order. */
export function formContextLinks(row: OperationsFormRow): readonly FormContextLink[] {
  return heldFormContexts(row.capabilities).map((context) => ({
    context,
    href: formContextHref(row.formId, context),
    label: t(`forms.tab.${context}`),
  }));
}

/**
 * The context a row's name opens, or `undefined` when the caller may open none of them.
 *
 * An eraser without a viewer grant lands on the known-target Erase screen, which lists
 * nothing and asks for a session id.
 */
export function primaryFormContext(row: OperationsFormRow): FormContextLink | undefined {
  return formContextLinks(row)[0];
}
