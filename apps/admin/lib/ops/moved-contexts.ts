/**
 * Where a form's old operational address goes now (Code Owner, 2026-11-02).
 *
 * The screens moved out of the form's own subtree and under Operations, so every address
 * that named one still has to arrive: a release outcome, a copied URL and a bookmark all
 * carry the old shape. The query survives the move, because a response list's filters and
 * an export's choices are the whole of what those addresses said.
 */

import { formContextHref, type FormContext } from "./form-contexts.ts";

/** One raw search-param value, as Next hands it over. */
type SearchParam = string | string[] | undefined;

export function operationalRedirect(
  formId: string,
  context: FormContext | "export",
  params: Readonly<Record<string, SearchParam>> = {},
  trailing = "",
): string {
  const base =
    context === "export"
      ? `/operations/forms/${encodeURIComponent(formId)}/export`
      : formContextHref(formId, context);
  const query = new URLSearchParams();
  for (const [name, raw] of Object.entries(params)) {
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (value !== undefined) query.append(name, value);
    }
  }
  const serialized = query.toString();
  return `${base}${trailing}${serialized === "" ? "" : `?${serialized}`}`;
}
