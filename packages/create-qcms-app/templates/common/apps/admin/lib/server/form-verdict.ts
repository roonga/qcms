import { cache } from "react";

import type { FormIssue } from "../forms/types.ts";
import type { DraftForm } from "../forms/types.ts";

import { validateDraft } from "./forms.ts";
import type { AdminSession } from "./session.ts";

/**
 * The API's dry run over one form's stored draft, computed at most once per request.
 *
 * ## Why it exists
 *
 * Two things on a form-scoped screen want the engine's verdict and they render in different
 * React trees: the §7 rail's per-step badges (`lib/server/form-rail.ts`, a parallel-route
 * slot) and, since issue #669, the rules screen's per-rule issue tags. `POST .../draft/validate`
 * writes nothing, so calling it twice is correct and merely wasteful - `cache()` from React
 * makes the second caller in a request free, the same way `getForm` and `currentAdminSession`
 * already do for their own reads.
 *
 * The keys line up because the callers share their inputs by construction: `getForm` is
 * itself memoized per request, so both hand this the SAME draft object, and `cache()` keys
 * on argument identity.
 *
 * **Per request, never across them.** `lib/server/form-rail.ts` states the rule this
 * respects: a verdict is per render by definition, and holding one between requests would be
 * this app deciding what the API decides (R2).
 *
 * ## Why the rules screen needs a verdict it did not ask for
 *
 * This is issue #669's constraint reaching one layer further than the links. Rule editing
 * moved to `/forms/{formId}/rules`, and that route is the DESTINATION of every rule-scoped
 * issue link - the validation panel's and the refused publish's alike. A reader arrives
 * there because something is wrong with a rule, so a screen that showed no issue on that
 * rule until the reader happened to edit something would have lost the behaviour the ruling
 * required it to keep. The client's own loop still refreshes the verdict on every save; this
 * is only what the screen opens knowing.
 *
 * The builder is deliberately NOT given this, and the difference is principled rather than
 * an omission: no cross-route link lands on the builder to show an issue (a pin and a step
 * anchor are same-page fragments), and its panel's "this draft has not been checked yet" is
 * a decision recorded on issue 625 - the count it shows must be one it computed. Changing
 * that is a separate question from moving the rules.
 */
export interface FormVerdict {
  readonly issues: readonly FormIssue[];
  readonly warnings: readonly FormIssue[];
}

/**
 * The verdict, or `undefined` when the dry run could not be had.
 *
 * `undefined` rather than an empty verdict, and the distinction is the whole point: an
 * empty issue list is an assertion that a draft would publish, and a failed read has no
 * basis for it. Every caller degrades instead of raising - the rail renders without badges,
 * the rules screen opens with the client's own "nothing has checked this yet" - because a
 * verdict is a companion to a screen rather than the screen.
 */
export const formVerdict: (
  session: AdminSession,
  formId: string,
  draft: DraftForm,
) => Promise<FormVerdict | undefined> = cache(
  async (
    session: AdminSession,
    formId: string,
    draft: DraftForm,
  ): Promise<FormVerdict | undefined> => {
    const result = await validateDraft(session, formId, draft);
    if (!result.ok) return undefined;
    return { issues: result.data.issues, warnings: result.data.warnings };
  },
);
