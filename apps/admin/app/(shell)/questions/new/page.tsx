import type { Metadata } from "next";

import { Card } from "@/components/kit";
import { QuestionEditor } from "@/components/questions/question-editor";
import { QuestionSave } from "@/components/questions/question-save";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { blankDefinition } from "@/lib/questions/definition";
import { requireAdminSession } from "@/lib/server/session";

import { createQuestionAction } from "../actions";

export function generateMetadata(): Metadata {
  return pageMetadata(t("questions.create.title"));
}

export default async function NewQuestionPage() {
  await requireAdminSession();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="qcms-question-head">
          <div className="qcms-question-head__id">
            <h1 className="text-xl font-semibold text-(--color-text)">
              {t("questions.create.title")}
            </h1>
          </div>
          <QuestionSave mode="create" />
        </div>
      </div>
      <div className="qcms-card">
        <Card padding="md" radius="md" border>
          <QuestionEditor
            mode="create"
            action={createQuestionAction}
            initialSlug=""
            initialDefinition={blankDefinition("shortText", "")}
            version={1}
          />
        </Card>
      </div>
    </div>
  );
}
