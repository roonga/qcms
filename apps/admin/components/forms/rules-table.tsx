"use client";

import { issueCountLabel } from "@/lib/forms/subtree-rail";
import { ruleAnchorId } from "@/lib/forms/issues";
import { ruleSentence } from "@/lib/forms/rule-sentence";
import { ruleScope, scopeChipLabel } from "@/lib/forms/rule-targets";
import { t } from "@/lib/i18n/en";
import type { ReadState } from "@/lib/read-state";
import type { DraftForm, DraftRule, FormIssue, PinnableQuestion } from "@/lib/forms/types";

export function RulesTable({
  draft,
  library,
  issues,
  onEdit,
  onRemove,
}: {
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly issues: readonly FormIssue[];
  readonly onEdit: (ruleId: string) => void;
  readonly onRemove: (ruleId: string) => void;
}) {
  return (
    <div className="qcms-table qcms-table--rules">
      <table>
        <caption className="qcms-visually-hidden">{t("forms.rules.title")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("forms.rules.column.rule")}</th>
            <th scope="col" className="qcms-cell--drop qcms-rulecell--issues">
              {t("forms.rules.column.issues")}
            </th>
          </tr>
        </thead>
        <tbody>
          {draft.rules.map((rule) => (
            <RuleRow
              key={rule.ruleId}
              rule={rule}
              draft={draft}
              library={library}
              issues={issues}
              onEdit={() => {
                onEdit(rule.ruleId);
              }}
              onRemove={() => {
                onRemove(rule.ruleId);
              }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RuleRow({
  rule,
  draft,
  library,
  issues,
  onEdit,
  onRemove,
}: {
  readonly rule: DraftRule;
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly issues: readonly FormIssue[];
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  const mine = issues.filter(
    (issue) => issue.path?.rule === rule.ruleId || (issue.path?.rules ?? []).includes(rule.ruleId),
  );
  const sentence = ruleSentence(rule, library, draft);
  // Scope is inferred from the rule and shown here; it is never an independently authored setting.
  const scope = scopeChipLabel(ruleScope(draft, rule.show));

  return (
    <tr id={ruleAnchorId(rule.ruleId)} tabIndex={-1} data-rule-id={rule.ruleId}>
      <td>
        <p className="qcms-rule-sentence">
          {sentence.map((segment, index) => (
            <span
              key={index}
              className={
                segment.kind === undefined ? undefined : `qcms-rule-sentence__${segment.kind}`
              }
            >
              {segment.text}
            </span>
          ))}
        </p>
        {scope !== undefined && (
          <p className="qcms-rule-scope">
            <span className="qcms-tag qcms-tag--draft" data-rule-scope={rule.ruleId}>
              {scope}
            </span>
          </p>
        )}
        <div className="qcms-rule-actions">
          <button type="button" className="qcms-rule-action" onClick={onEdit}>
            {t("forms.rules.edit")}
          </button>
          <button type="button" className="qcms-rule-action" onClick={onRemove}>
            {t("forms.rules.remove")}
          </button>
        </div>
      </td>
      <td className="qcms-cell--drop qcms-rulecell--issues">
        {mine.length > 0 && (
          <span className="qcms-tag qcms-tag--draft" data-rule-issues={mine.length}>
            {issueCountLabel(mine.length)}
          </span>
        )}
      </td>
    </tr>
  );
}
