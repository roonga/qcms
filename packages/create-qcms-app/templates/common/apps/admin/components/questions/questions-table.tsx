import { EntityId } from "@/components/entity-id";
import { OperatorDay } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";
import type { QuestionListItem } from "@/lib/questions/types";

export function QuestionsTable({ rows }: { readonly rows: readonly QuestionListItem[] }) {
  return (
    <div className="qcms-table qcms-table--questions">
      <table data-testid="qcms-questions-table">
        <caption className="qcms-visually-hidden">{t("questions.table.label")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("questions.column.id")}</th>
            <th scope="col">{t("questions.column.label")}</th>
            <th scope="col" className="qcms-cell--drop">
              {t("questions.column.type")}
            </th>
            <th scope="col" className="qcms-cell--num">
              {t("questions.column.version")}
            </th>
            <th scope="col">{t("questions.column.status")}</th>
            <th scope="col" className="qcms-cell--num qcms-cell--drop">
              {t("questions.column.created")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((question) => (
            <tr key={question.questionId} data-question-id={question.questionId}>
              <th scope="row">
                <EntityId
                  kind="question"
                  value={question.questionId}
                  href={`/questions/${encodeURIComponent(question.questionId)}`}
                  linkLabel={(shown) => t("questions.open", { questionId: shown })}
                />
              </th>
              <td>{textOf(question.label ?? undefined)}</td>
              <td className="qcms-cell--drop">
                {question.type === null
                  ? t("questions.column.typeUnknown")
                  : t(`questions.type.${question.type}`)}
              </td>
              <td className="qcms-cell--num">v{question.latestVersion}</td>
              <td>{t(`questions.status.${question.latestStatus}`)}</td>
              <td className="qcms-cell--num qcms-cell--drop">
                <OperatorDay iso={question.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
