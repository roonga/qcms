"use client";

import { useBuilderAssist } from "@/lib/agent/builder-assist-bridge";
import { displayText } from "@/lib/agent/card-copy";
import {
  isPendingNewQuestionPin,
  pendingNewQuestionPins,
  proposalDiff,
  type DiffEntry,
} from "@/lib/forms/assist-diff";
import type { AgentDraftProposal } from "@/lib/forms/assist-stream";
import type { DraftForm, FormIssue } from "@/lib/forms/types";
import { t, tPlural, type MessageKey } from "@/lib/i18n/en";

import { IssueEntry } from "@/components/forms/validation-panel";

/* Keep blocking issues separate from advisory warnings so one count cannot imply both prevent publishing. */
export function ApplyDraftDetail({
  draft,
  id,
}: {
  readonly draft: AgentDraftProposal;
  readonly id: string;
}) {
  const builder = useBuilderAssist();
  const current = builder?.draft;
  const diff =
    current === undefined ? undefined : proposalDiff(current, draft.definition, draft.newQuestions);
  const pendingPins = pendingNewQuestionPins(draft.definition, draft.newQuestions);
  const createdBy = new Map((draft.createdBy ?? []).map((entry) => [entry.questionId, entry.step]));
  const titles = newQuestionTitles(draft.newQuestions);

  return (
    <div className="qcms-acard__draft" data-testid="qcms-acard-draft">
      {diff === undefined ? null : (
        <>
          <p className="qcms-acard__label">
            {tPlural("forms.assist.diffCount.one", "forms.assist.diffCount.other", diff.length)}
          </p>
          <ul className="qcms-acard__diff" data-testid="qcms-acard-diff">
            {diff.length === 0 ? (
              <li>{t("forms.assist.diffEmpty")}</li>
            ) : (
              diff.map((entry) => (
                <li key={`${entry.kind}:${entry.id}`}>
                  <details>
                    <summary>{diffLineText(entry)}</summary>
                    <pre>{entry.detail}</pre>
                  </details>
                </li>
              ))
            )}
          </ul>
        </>
      )}

      <div data-testid="qcms-acard-issues" id={`${id}-issues`}>
        {draft.issues.length === 0 ? (
          <p className="qcms-acard__label">{t("forms.assist.validationClean")}</p>
        ) : (
          <>
            <p className="qcms-acard__label">
              {tPlural("forms.validation.countOne", "forms.validation.count", draft.issues.length)}
            </p>
            <ul className="qcms-acard__advisory">
              {draft.issues.map((issue, index) => (
                <li key={`${issue.code}:${String(index)}`}>
                  <DraftIssue
                    issue={issue}
                    current={current}
                    pendingPins={pendingPins}
                    createdBy={createdBy}
                    titles={titles}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {draft.warnings.length === 0 ? null : (
        <div data-testid="qcms-acard-warnings" id={`${id}-warnings`}>
          <h3 className="qcms-acard__subhead">{t("forms.warning.heading")}</h3>
          <p className="qcms-acard__label">
            {tPlural("forms.warning.countOne", "forms.warning.count", draft.warnings.length)}
          </p>
          <ul className="qcms-acard__advisory">
            {draft.warnings.map((warning, index) => (
              <li key={`${warning.code}:${String(index)}`}>
                <DraftIssue
                  issue={warning}
                  current={current}
                  pendingPins={pendingPins}
                  createdBy={createdBy}
                  titles={titles}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* A proposed question is named by the label the operator is about to confirm, not by its id. */
function newQuestionTitles(newQuestions: readonly unknown[]): ReadonlyMap<string, string> {
  const titles = new Map<string, string>();
  for (const entry of newQuestions) {
    if (typeof entry !== "object" || entry === null) continue;
    const fields = entry as Record<string, unknown>;
    const questionId = fields["questionId"];
    const label = displayText(fields["label"]);
    if (typeof questionId === "string" && label !== undefined) titles.set(questionId, label);
  }
  return titles;
}

function DraftIssue({
  issue,
  current,
  pendingPins,
  createdBy,
  titles,
}: {
  readonly issue: FormIssue;
  readonly current: DraftForm | undefined;
  readonly pendingPins: ReadonlySet<string>;
  readonly createdBy: ReadonlyMap<string, number>;
  readonly titles: ReadonlyMap<string, string>;
}) {
  const questionId = issue.path?.question;
  if (questionId !== undefined && isPendingNewQuestionPin(issue, pendingPins)) {
    const step = createdBy.get(questionId);
    const question = titles.get(questionId) ?? questionId;
    return (
      <span data-issue-code={issue.code} data-new-question={questionId}>
        {step === undefined
          ? t("forms.assist.newQuestionPending", { question })
          : t("forms.assist.newQuestionFromStep", { question, step: step + 1 })}
      </span>
    );
  }
  if (current === undefined) return <span data-issue-code={issue.code}>{issue.message}</span>;
  return <IssueEntry issue={issue} draft={current} />;
}

const KIND_LABELS: Readonly<Record<DiffEntry["kind"], MessageKey>> = {
  step: "forms.assist.kind.step",
  question: "forms.assist.kind.question",
  rule: "forms.assist.kind.rule",
};

function diffLineText(entry: DiffEntry): string {
  const label = `${t(KIND_LABELS[entry.kind])}: ${entry.label}`;
  return entry.change === "added"
    ? t("forms.assist.diffAdded", { label })
    : t("forms.assist.diffChanged", { label });
}
