import type { Metadata } from "next";

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
  await requireAdminSession();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="sr-only">{t("forms.create.title")}</h1>
      </div>
      <div className="qcms-card">
        <Card padding="md" radius="md" border>
          <CreateForm action={createFormAction} />
        </Card>
      </div>
    </div>
  );
}
