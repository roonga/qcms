import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { BuilderShell } from "@/components/forms/builder-shell";
import { builderFormName, mayBuildForm } from "@/lib/forms/build-access";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { agentAuthoringEnabled } from "@/lib/server/agent";
import { previewPortalTheme } from "@/lib/server/config";
import { getForm } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";

import { previewDraftAction, startBuildDraftAction } from "../../actions";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(t("title.builder", { subject: formId }));
}

/* A caller who may not write the draft gets the same 404 as a form it cannot see, so the route
   discloses nothing and offers no tool. */
export default async function FormBuildPage({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}) {
  if (!agentAuthoringEnabled()) notFound();
  const session = await requireAdminSession();
  const { formId } = await params;
  const [detail, workspaceId] = await Promise.all([
    getForm(session, formId),
    currentWorkspaceId(session),
  ]);

  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;
  if (!mayBuildForm(form)) notFound();

  return (
    <BuilderShell
      formId={form.formId}
      name={builderFormName(form)}
      userId={session.userId}
      workspaceId={workspaceId ?? ""}
      canPublish={form.workflow?.canPublish !== false}
      preview={{
        draft: form.draft,
        preview: previewDraftAction.bind(null, form.formId),
        defaultTheme: previewPortalTheme(),
        appearance: form.appearance ?? null,
      }}
      {...(form.draftSource === "open"
        ? {}
        : { startDraft: startBuildDraftAction.bind(null, form.formId) })}
    />
  );
}
