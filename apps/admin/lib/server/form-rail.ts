import { stepIssueCounts } from "../forms/issues.ts";
import { textOf } from "../questions/definition.ts";
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
 * contract asks for, and the call writes nothing.
 *
 * **That one call is now the whole of the rail's cost** (issue #626). It used to be
 * three: the slot also re-read the session and re-read the form, both of which the page
 * beside it had already read in the same request. Those two are memoized per request at
 * their own definitions (`session.ts`, `forms.ts`) rather than worked around here, which
 * is what issue 561 concluded when it was pointed at this seam - the duplication was in
 * the app's server-read strategy, not in the rail's loader. The validation deliberately
 * did NOT join them: a verdict is per render by definition, and caching it across
 * requests would be this app deciding what the API decides (R2).
 *
 * NOTHING HERE IS FATAL. A rail is navigation beside a page, never the page, so every
 * failure degrades instead of raising: a form that cannot be read gets no rail at all and
 * leaves its screen's own 404 or error alert to speak, and a validation that fails gets a
 * rail with no badges rather than one quietly claiming every step is clean. The screen has
 * already read the same form for itself, so a rail is never the only thing on a page.
 *
 * ## One screen asks for the siblings only, and then there is nothing to validate
 *
 * The builder's rail carries §7's sibling group and no children (issue 561). The
 * derivation is §7's own: a step item is `/forms/{id}#step-{stepId}`,
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
  /**
   * The form's own title, or `""` when it has none yet.
   *
   * Separate from {@link slug} because they answer different questions: the slug is how
   * the form is ADDRESSED and appears in every URL, the title is what an author called it.
   * The rail shows the title where there is one, and the empty string is a real state -
   * a form created and not yet named - which is why this is not optional-and-absent.
   */
  readonly title: string;
  /** The form's steps, or empty when the form has no draft to read them from. */
  readonly steps: readonly DraftStep[];
  /** Issues per step id. Empty when there is no verdict, never a stand-in for zero. */
  readonly issueCounts: ReadonlyMap<string, number>;
}

/**
 * The rail's data for one form, or `null` when the form itself could not be read.
 *
 * There is no "siblings only" mode, and its removal on 2026-08-25 is the point rather than
 * a tidy-up. The builder was the one screen that asked for one, on §7's retired reading
 * that a step row there would be a same-page fragment; now that every form screen carries
 * the same tree, a parameter for suppressing the steps could only ever reintroduce the
 * split it closed - one screen showing a different rail from its seven siblings.
 */
export async function loadFormRail(
  session: AdminSession,
  formId: string,
): Promise<FormRailData | null> {
  const detail = await getForm(session, formId);
  if (!detail.ok) return null;
  const form = detail.data;
  const draft = form.draft;
  if (draft === null) {
    return { formId: form.formId, slug: form.slug, title: "", steps: [], issueCounts: new Map() };
  }
  const verdict = await validateDraft(session, form.formId, draft);
  return {
    formId: form.formId,
    slug: form.slug,
    title: textOf(draft.title, form.defaultLocale),
    steps: draft.steps,
    issueCounts: verdict.ok ? stepIssueCounts(verdict.data.issues, draft) : new Map(),
  };
}
