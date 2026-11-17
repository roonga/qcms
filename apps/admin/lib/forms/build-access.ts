import type { MyAccess } from "../membership/types.ts";

import type { FormDetail } from "./types.ts";

/** The role that may write a draft; every other form role reaches no builder tool. */
export const EDIT_FORMS_ROLE = "forms.editor";

/** Whether a form's builder opens at all: the API's own write flag, and not a review-only workflow. */
export function mayBuildForm(form: Pick<FormDetail, "canWriteDraft" | "workflow">): boolean {
  if (!form.canWriteDraft) return false;
  return !(form.workflow?.enabled === true && !form.workflow.canEdit);
}

/**
 * Whether the caller holds Edit forms in a workspace, or in any when none is named. It only decides
 * whether a builder entry is offered: an unreadable record offers it, since the API still refuses.
 */
export function holdsEditForms(
  access: MyAccess | undefined,
  workspaceId: string | undefined,
): boolean {
  if (access === undefined) return true;
  return access.workspaces.some(
    (workspace) =>
      !workspace.archived &&
      (workspaceId === undefined || workspace.workspaceId === workspaceId) &&
      workspace.grants.some((grant) => grant.roles.includes(EDIT_FORMS_ROLE)),
  );
}

/** The name the builder shows: the draft's title, else the slug. */
export function builderFormName(form: Pick<FormDetail, "draft" | "slug" | "defaultLocale">) {
  const title = form.draft?.title ?? {};
  const text = (title[form.defaultLocale] ?? Object.values(title)[0] ?? "").trim();
  return text === "" ? form.slug : text;
}
