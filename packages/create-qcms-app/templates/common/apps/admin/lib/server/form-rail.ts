import { stepIssueCounts } from "../forms/issues.ts";
import { textOf } from "../questions/definition.ts";
import type { DraftStep } from "../forms/types.ts";

import { getForm } from "./forms.ts";
import { formVerdict } from "./form-verdict.ts";
import type { AdminSession } from "./session.ts";

/** Navigation failures must degrade without failing the page. Failed validation omits badges; it must not claim a clean draft. The API verdict is memoized only within the request. */

export interface FormRailData {
  readonly formId: string;
  readonly slug: string;
  /** An empty title is an unnamed form, not a missing field; the slug remains its address. */
  readonly title: string;
  /** Read open/closed from the form, not the draft: intake can close while the draft still exists. */
  readonly status: "open" | "closed";

  readonly steps: readonly DraftStep[];
  /** Issues per step id. Empty when there is no verdict, never a stand-in for zero. */
  readonly issueCounts: ReadonlyMap<string, number>;
}

/** Every form screen receives the same steps; suppressing them per screen would split the navigation tree. */
export async function loadFormRail(
  session: AdminSession,
  formId: string,
): Promise<FormRailData | null> {
  const detail = await getForm(session, formId);
  if (!detail.ok) return null;
  const form = detail.data;
  // Always the draft: the rail names the form being authored, and no environment selection changes that.
  const draft = form.draft;
  if (draft === null) {
    return {
      formId: form.formId,
      slug: form.slug,
      title: "",
      status: form.status,
      steps: [],
      issueCounts: new Map(),
    };
  }

  const verdict = await formVerdict(session, form.formId, draft);
  return {
    formId: form.formId,
    slug: form.slug,
    title: textOf(draft.title, form.defaultLocale),
    status: form.status,
    steps: draft.steps,
    issueCounts: verdict === undefined ? new Map() : stepIssueCounts(verdict.issues, draft),
  };
}
