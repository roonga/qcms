"use client";

import Link from "next/link";

import { HelpTip } from "@/components/help-tip";
import { issuesForRule, NEW_RULE_HASH, ruleHref, rulesHref } from "@/lib/forms/issues";
import { ruleSentence, type RuleSentenceSegment } from "@/lib/forms/rule-sentence";
import { issueCountLabel } from "@/lib/forms/subtree-rail";
import type { DraftForm, FormIssue, PinnableQuestion } from "@/lib/forms/types";
import { t, tPlural } from "@/lib/i18n/en";
import type { ReadState } from "@/lib/read-state";

export function RulesLens({
  draft,
  library,
  issues,
}: {
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly issues: readonly FormIssue[];
}) {
  const href = rulesHref(draft.formId);
  const canAdd = draft.steps.some((step) => step.items.length > 0);

  return (
    <section
      aria-labelledby="qcms-rules-lens-heading"
      className="flex flex-col gap-3 rounded-md border border-(--color-border) bg-(--color-background-muted) p-4"
      data-testid="qcms-rules-lens"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="qcms-rules-lens-heading" className="text-base font-semibold text-(--color-text)">
          {t("forms.tab.rules")}
        </h2>
        <span className="text-sm text-(--color-text-muted)" data-rule-count={draft.rules.length}>
          {tPlural("forms.rules.lensCountOne", "forms.rules.lensCount", draft.rules.length)}
        </span>
        <HelpTip>{t("forms.rules.lensNote")}</HelpTip>
      </div>

      {draft.rules.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)">{t("forms.rules.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {draft.rules.map((rule) => (
            <li key={rule.ruleId}>
              <RuleLine
                href={ruleHref(draft.formId, rule.ruleId)}
                sentence={ruleSentence(rule, library, draft)}
                issueCount={issuesForRule(issues, rule.ruleId).length}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Link href={href} className="qcms-text-link" data-testid="qcms-rules-lens-edit">
          {t("forms.rules.editAll")}
        </Link>
        {canAdd ? (
          <Link
            href={`${href}${NEW_RULE_HASH}`}
            className="qcms-text-link"
            data-testid="qcms-rules-lens-add"
          >
            {t("forms.rules.add")}
          </Link>
        ) : (
          <span className="text-sm text-(--color-text-muted)">{t("forms.rules.needPin")}</span>
        )}
      </div>
    </section>
  );
}

function RuleLine({
  href,
  sentence,
  issueCount,
}: {
  readonly href: string;
  readonly sentence: readonly RuleSentenceSegment[];
  readonly issueCount: number;
}) {
  return (
    <Link href={href} className="qcms-text-link block">
      <span className="qcms-rule-sentence">
        {sentence.map((segment, index) => (
          <span
            // Sentence segments are positional and replaced together; their indexes do not represent persistent entity
            // identity.
            key={index}
            className={
              segment.kind === undefined ? undefined : `qcms-rule-sentence__${segment.kind}`
            }
          >
            {segment.text}
          </span>
        ))}
      </span>
      {issueCount > 0 && (
        <span className="qcms-tag qcms-tag--draft" data-rule-issues={issueCount}>
          {issueCountLabel(issueCount)}
        </span>
      )}
    </Link>
  );
}
