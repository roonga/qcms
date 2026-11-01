"use client";

import { useBuilderAssist } from "@/lib/agent/builder-assist-bridge";
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

/**
 * What the `apply-draft` step shows beyond its arguments: the diff against the builder's
 * working draft, in full, and the server's two advisory lists.
 *
 * Two lists rather than one, and never folded together: an issue is why a publish would be
 * refused and a warning blocks nothing, so one count leaves an author unable to tell which
 * one stops them. The headings and the summary sentences are the builder's own validation
 * panel's, because this is the same verdict about the same draft.
 */
export function ApplyDraftDetail({
  draft,
  id,
}: {
  readonly draft: AgentDraftProposal;
  /** The step's own element id, so each block below is addressable. */
  readonly id: string;
}) {
  const builder = useBuilderAssist();
  const current = builder?.draft;
  const diff =
    current === undefined ? undefined : proposalDiff(current, draft.definition, draft.newQuestions);
  const pendingPins = pendingNewQuestionPins(draft.definition, draft.newQuestions);

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
                  <DraftIssue issue={issue} current={current} pendingPins={pendingPins} />
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
                <DraftIssue issue={warning} current={current} pendingPins={pendingPins} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * One advisory entry, as the builder renders it, except the one case the builder never
 * meets: a step pin on a question this same draft invents, which Confirm will make resolve.
 * Before that the question is not stored, so the kernel calls the pin `DANGLING_QUESTION_REF`
 * and the builder's sentence for that code tells the author to pin a question that is
 * already pinned. Say what actually happens instead (issue #1065). It still blocks a
 * publish, so it stays in the count.
 */
function DraftIssue({
  issue,
  current,
  pendingPins,
}: {
  readonly issue: FormIssue;
  readonly current: DraftForm | undefined;
  readonly pendingPins: ReadonlySet<string>;
}) {
  const questionId = issue.path?.question;
  if (questionId !== undefined && isPendingNewQuestionPin(issue, pendingPins)) {
    return (
      <span data-issue-code={issue.code} data-new-question={questionId}>
        {t("forms.assist.newQuestionPending", { questionId })}
      </span>
    );
  }
  // Without a mounted builder there is no draft to anchor a link into, so the sentence
  // stands on its own.
  if (current === undefined) return <span data-issue-code={issue.code}>{issue.message}</span>;
  return <IssueEntry issue={issue} draft={current} />;
}

const KIND_LABELS: Readonly<Record<DiffEntry["kind"], MessageKey>> = {
  step: "forms.assist.kind.step",
  question: "forms.assist.kind.question",
  rule: "forms.assist.kind.rule",
};

/** One diff line's text, marked `Added` or `Changed` rather than by colour alone. */
function diffLineText(entry: DiffEntry): string {
  const label = `${t(KIND_LABELS[entry.kind])}: ${entry.label}`;
  return entry.change === "added"
    ? t("forms.assist.diffAdded", { label })
    : t("forms.assist.diffChanged", { label });
}
