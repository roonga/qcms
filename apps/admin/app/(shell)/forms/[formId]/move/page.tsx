import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { FormPageHeader } from "@/components/forms/form-page-header";
import { MoveFormPanel } from "@/components/forms/move-form-panel";
import { Alert } from "@/components/kit";
import { moveDestinations } from "@/lib/forms/move";
import { t } from "@/lib/i18n/en";
import { formSectionName, pageMetadata } from "@/lib/page-title";
import { getForm } from "@/lib/server/forms";
import { readMyAccess } from "@/lib/server/membership";
import { readMovePreview } from "@/lib/server/move-form";
import { requireAdminSession } from "@/lib/server/session";

import { moveFormAction } from "./actions";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ formId: string }>;
}): Promise<Metadata> {
  const { formId } = await params;
  return pageMetadata(formSectionName("move", formId));
}

/* The destination is a query parameter so the preview is server-rendered: who gains and who
   loses is the API's answer, never a guess made beside the chooser. */
export default async function FormMovePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ formId: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const { formId } = await params;
  const query = (await searchParams) ?? {};
  const detail = await getForm(session, formId);
  if (!detail.ok) {
    if (detail.code === "FORM_NOT_FOUND" || detail.code === "INVALID_FORM_ID") notFound();
    return <Alert variant="error">{detail.message}</Alert>;
  }
  const form = detail.data;

  const access = await readMyAccess(session);
  const workspaces = access.ok ? access.data.workspaces : [];
  const destinations = moveDestinations(workspaces, form.workspaceId);
  const source =
    workspaces.find((workspace) => workspace.workspaceId === form.workspaceId)?.name ??
    form.workspaceId;

  const asked = typeof query["to"] === "string" ? query["to"] : undefined;
  const chosen = destinations.find((destination) => destination.workspaceId === asked);
  const preview =
    chosen === undefined ? undefined : await readMovePreview(session, formId, chosen.workspaceId);

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader
        formId={form.formId}
        section="move"
        form={form}
        help={t("forms.move.intro")}
      />
      {!access.ok && <Alert variant="error">{access.message}</Alert>}
      <MoveFormPanel
        formId={form.formId}
        source={source}
        destinations={destinations}
        {...(chosen === undefined ? {} : { chosen })}
        {...(preview === undefined || !preview.ok ? {} : { preview: preview.data })}
        {...(preview !== undefined && !preview.ok ? { error: preview.message } : {})}
        move={moveFormAction}
      />
    </div>
  );
}
