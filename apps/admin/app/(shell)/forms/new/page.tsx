import type { Metadata } from "next";

import { SwitchToTest } from "@/components/forms/switch-to-test";
import { Alert } from "@/components/kit";
import { resolvedEnvironment } from "@/lib/server/environments";
import { secureCookies } from "@/lib/server/config";
import { Card } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { requireAdminSession } from "@/lib/server/session";

import { createFormAction } from "../actions";
import { CreateForm } from "./create-form";

export function generateMetadata(): Metadata {
  return pageMetadata(t("forms.create.title"));
}

export default async function NewFormPage() {
  const session = await requireAdminSession();
  const resolved = await resolvedEnvironment(session);
  const production =
    resolved.status === "known" &&
    resolved.environment === "prod" &&
    resolved.environments.includes("test");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">{t("forms.create.title")}</h1>
      </div>
      <div className="qcms-card">
        <Card padding="md" radius="md" border>
          {production ? (
            <div className="flex flex-col gap-3">
              <Alert variant="info">{t("forms.workflow.editInTest")}</Alert>
              <SwitchToTest secure={secureCookies()} />
            </div>
          ) : (
            <CreateForm action={createFormAction} />
          )}
        </Card>
      </div>
    </div>
  );
}
