import Link from "next/link";
import type { Metadata } from "next";

import { Card } from "@/components/kit";
import { holdsEditForms } from "@/lib/forms/build-access";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { agentAuthoringEnabled } from "@/lib/server/agent";
import { readMyAccess } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";
import { NEW_FORM_BUILD_PATH } from "@/lib/shell/modes";

import { createFormAction } from "../actions";
import { CreateForm } from "./create-form";

export function generateMetadata(): Metadata {
  return pageMetadata(t("forms.create.title"));
}

async function offersBuilder(session: Awaited<ReturnType<typeof requireAdminSession>>) {
  if (!agentAuthoringEnabled()) return false;
  const [access, workspaceId] = await Promise.all([
    readMyAccess(session),
    currentWorkspaceId(session),
  ]);
  return holdsEditForms(access.ok ? access.data : undefined, workspaceId);
}

export default async function NewFormPage() {
  const session = await requireAdminSession();
  const builder = await offersBuilder(session);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="sr-only">{t("forms.create.title")}</h1>
      </div>
      {builder && (
        <section
          className="flex flex-col items-start gap-2"
          aria-labelledby="qcms-new-form-assistant-heading"
          data-testid="qcms-new-form-assistant"
        >
          <h2 id="qcms-new-form-assistant-heading" className="text-base font-semibold">
            {t("forms.create.assistant")}
          </h2>
          <p className="text-sm text-(--color-text-muted)">{t("forms.create.assistantHint")}</p>
          <Link
            href={NEW_FORM_BUILD_PATH}
            className="qcms-button-link"
            data-testid="qcms-new-form-build"
          >
            {t("forms.create.assistant")}
          </Link>
        </section>
      )}
      <section
        className="flex flex-col gap-2"
        {...(builder ? { "aria-labelledby": "qcms-new-form-blank-heading" } : {})}
      >
        {builder && (
          <h2 id="qcms-new-form-blank-heading" className="text-base font-semibold">
            {t("forms.create.blank")}
          </h2>
        )}
        <div className="qcms-card">
          <Card padding="md" radius="md" border>
            <CreateForm action={createFormAction} />
          </Card>
        </div>
      </section>
    </div>
  );
}
