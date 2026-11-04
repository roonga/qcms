import { cache } from "react";

import type { FormIssue } from "../forms/types.ts";
import type { DraftForm } from "../forms/types.ts";

import { validateDraft } from "./forms.ts";
import type { AdminSession } from "./session.ts";

/** Share one dry run between the rail and rules page within a request. React cache keys by identity, so callers must share the memoized draft object; never retain verdicts across requests. */
export interface FormVerdict {
  readonly issues: readonly FormIssue[];
  readonly warnings: readonly FormIssue[];
}

/** Undefined means no verdict was obtained; an empty issue list would falsely assert publishability. Callers degrade without failing the page. */
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
