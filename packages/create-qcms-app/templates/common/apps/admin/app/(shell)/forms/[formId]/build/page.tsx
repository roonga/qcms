import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { BuilderShell } from "@/components/forms/builder-shell";
import { builderFormName, mayBuildForm } from "@/lib/forms/build-access";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { agentAuthoringEnabled } from "@/lib/server/agent";
import { faceOptions, shippedThemeOptions } from "@/lib/server/appearance-options";
import { previewPortalBrand, previewPortalTheme } from "@/lib/server/config";
import { getForm } from "@/lib/server/forms";
import { listWorkspaceThemes, themeOption } from "@/lib/server/themes";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";

import {
  applyAgentEditAction,
  createWorkspaceThemeAction,
  deriveWorkspaceThemeAction,
  previewDraftAction,
  readStoredDraftAction,
  saveAppearanceAction,
  startBuildDraftAction,
} from "../../actions";

import "./preview-fonts.css";

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

  /* A refused themes read leaves the shipped themes, which every workspace may use anyway. */
  const saved = await listWorkspaceThemes(session, form.workspaceId);
  const themes = [
    ...shippedThemeOptions(),
    ...(saved.ok ? saved.data.themes.map(themeOption) : []),
  ];

  return (
    <BuilderShell
      formId={form.formId}
      name={builderFormName(form)}
      userId={session.userId}
      workspaceId={workspaceId ?? ""}
      canPublish={form.workflow?.canPublish !== false}
      draft={form.draft}
      edits={{
        apply: applyAgentEditAction.bind(null, form.formId),
        readStored: readStoredDraftAction.bind(null, form.formId),
      }}
      preview={{
        draft: form.draft,
        preview: previewDraftAction.bind(null, form.formId),
        defaultTheme: previewPortalTheme(),
        appearance: form.appearance ?? null,
        brand: previewPortalBrand(),
        themes,
        faces: faceOptions(),
        appearanceLocked: form.appearanceLocked === true,
        saveAppearance: saveAppearanceAction.bind(null, form.formId),
        deriveTheme: deriveWorkspaceThemeAction.bind(null, form.workspaceId),
        createTheme: createWorkspaceThemeAction.bind(null, form.workspaceId),
      }}
      {...(form.draftSource === "open"
        ? {}
        : { startDraft: startBuildDraftAction.bind(null, form.formId) })}
    />
  );
}
