import { stepIssueCounts } from "../forms/issues.ts";
import type { DraftStep } from "../forms/types.ts";

import { getForm, validateDraft } from "./forms.ts";
import type { AdminSession } from "./session.ts";

/**
 * The two reads behind the §7 rail (issue 559).
 *
 * The rail carries a form's steps WITH their issue counts, and those are two different
 * answers from the API: the steps come from the form detail, and how many issues each
 * carries is a verdict only `POST .../draft/validate` can give (R2 - this app never
 * decides whether a draft is legal, and `lib/forms/issues.ts` only attributes a verdict it
 * is handed). So a rail costs one extra dry-run validation per render of a form-scoped
 * screen. That cost is stated here rather than hidden: it is the price of the badge the
 * contract asks for, the call writes nothing, and it is the one place to change if issue
 * 561 decides eight screens should share a cheaper source.
 *
 * NOTHING HERE IS FATAL. A rail is navigation beside a page, never the page, so every
 * failure degrades instead of raising: a form that cannot be read gets no rail at all and
 * leaves its screen's own 404 or error alert to speak, and a validation that fails gets a
 * rail with no badges rather than one quietly claiming every step is clean. The screen has
 * already read the same form for itself, so a rail is never the only thing on a page.
 *
 * ## One screen asks for the siblings only, and then there is nothing to validate
 *
 * The builder's rail carries §7's sibling group and no children (issue 561, PM seat ruling
 * on that issue). The derivation is §7's own: a step item is `/forms/{id}#step-{stepId}`,
 * which is a cross-route link everywhere else and a bare same-page fragment on the
 * builder, and §7 says the rail "never carries same-page section switches". With no step
 * rows there is no badge, and with no badge the dry-run validation buys nothing - so
 * {@link loadFormRail} skips it rather than paying for a verdict nothing renders. That is
 * this module doing the job its own note above claims: being the one place the rail's cost
 * is decided.
 */

/** What a rail needs about one form, once its reads have landed. */
export interface FormRailData {
  readonly formId: string;
  readonly slug: string;
  /** The form's steps, or empty when the caller asked for the siblings alone. */
  readonly steps: readonly DraftStep[];
  /** Issues per step id. Empty when there is no verdict, never a stand-in for zero. */
  readonly issueCounts: ReadonlyMap<string, number>;
}

/** Which of §7's two groups a screen's rail is asking for. */
export type RailChildren = "steps" | "none";

/** The rail's data for one form, or `null` when the form itself could not be read. */
export async function loadFormRail(
  session: AdminSession,
  formId: string,
  children: RailChildren = "steps",
): Promise<FormRailData | null> {
  const detail = await getForm(session, formId);
  if (!detail.ok) return null;
  const form = detail.data;
  const draft = form.draft;
  if (children === "none" || draft === null) {
    return { formId: form.formId, slug: form.slug, steps: [], issueCounts: new Map() };
  }
  const verdict = await validateDraft(session, form.formId, draft);
  return {
    formId: form.formId,
    slug: form.slug,
    steps: draft.steps,
    issueCounts: verdict.ok ? stepIssueCounts(verdict.data.issues, draft) : new Map(),
  };
}
