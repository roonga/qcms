import Link from "next/link";

import { Card } from "@/components/kit";
import { QuestionEditor } from "@/components/questions/question-editor";
import { t } from "@/lib/i18n/en";
import { blankDefinition } from "@/lib/questions/definition";
import { requireAdminSession } from "@/lib/server/session";

import { createQuestionAction } from "../actions";

/**
 * Creating a question (task 032; screen contract "editor new" state).
 *
 * The only screen where `slug` and `type` can be chosen, and it says so in the two notes
 * beside them. That is not decoration: an id is permanent and never reused for a
 * different meaning, and a type change is a different answer shape and therefore a
 * different question (R6). An author who learns that here never has to discover it from
 * a `QUESTION_ID_REUSED` error later.
 *
 * `requireAdminSession()` is called even though the `(shell)` layout already did: this
 * page reads nothing from the session, but calling it keeps the guarantee local to the
 * file rather than inherited from a layout someone could later move the route out of.
 */
export default async function NewQuestionPage() {
  await requireAdminSession();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/questions" className="qcms-text-link">
          {t("questions.backToList")}
        </Link>
        <h1 className="text-xl font-semibold text-(--color-text)">{t("questions.create.title")}</h1>
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
