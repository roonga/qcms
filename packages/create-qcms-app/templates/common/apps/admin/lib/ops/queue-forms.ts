/** Form names for a global queue's rows, keyed by form id. */
export type QueueFormNames = Readonly<Record<string, string>>;

interface NamedForm {
  readonly formId: string;
  readonly slug: string;
}

/**
 * The names of the forms this caller may read. A queue row whose form is not among them
 * shows its id, and a refused or failed read names nothing rather than refusing the queue.
 */
export function queueFormNames(
  forms: { readonly ok: true; readonly data: readonly NamedForm[] } | { readonly ok: false },
): QueueFormNames {
  if (!forms.ok) return {};
  return Object.fromEntries(forms.data.map((form) => [form.formId, form.slug]));
}

/** The name a queue row shows for its form, or `undefined` when the caller holds no read on it. */
export function queueFormName(names: QueueFormNames, formId: string): string | undefined {
  return Object.hasOwn(names, formId) ? names[formId] : undefined;
}
