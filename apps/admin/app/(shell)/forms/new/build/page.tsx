import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { BuilderShell } from "@/components/forms/builder-shell";
import { holdsEditForms } from "@/lib/forms/build-access";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { agentAuthoringEnabled } from "@/lib/server/agent";
import { readMyAccess } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";

export function generateMetadata(): Metadata {
  return pageMetadata(t("title.builder", { subject: t("builder.newForm") }));
}

/* No form exists here until the first confirmed step creates one, so an abandoned visit leaves nothing. */
export default async function NewFormBuildPage() {
  if (!agentAuthoringEnabled()) notFound();
  const session = await requireAdminSession();
  const [access, workspaceId] = await Promise.all([
    readMyAccess(session),
    currentWorkspaceId(session),
  ]);
  if (!holdsEditForms(access.ok ? access.data : undefined, workspaceId)) notFound();

  return (
    <BuilderShell
      formId={null}
      name={t("builder.newForm")}
      userId={session.userId}
      workspaceId={workspaceId ?? ""}
      canPublish={false}
    />
  );
}
