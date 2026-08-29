"use client";

import { issueCountLabel } from "@/lib/forms/subtree-rail";
import { ruleAnchorId } from "@/lib/forms/issues";
import { ruleSentence } from "@/lib/forms/rule-sentence";
import { t } from "@/lib/i18n/en";
import type { ReadState } from "@/lib/read-state";
import type { DraftForm, DraftRule, FormIssue, PinnableQuestion } from "@/lib/forms/types";

/**
 * The form's rules, as a list you can read (Code Owner, 2026-08-26).
 *
 * ## Why a table where there was an editor per rule
 *
 * Every rule rendered its whole `ConditionEditor` inline - a nested boolean tree beside a
 * JSON pane - so a form with four rules was four expanded editors stacked, and answering
 * "what does this form actually do" meant reading four editors instead of four sentences.
 * A rule is small to STATE and large to CHANGE, and this screen now does the first.
 *
 * ## Why it reads as English
 *
 * "When X is answered, show Y" is the Code Owner's own phrasing, and it is the whole point:
 * a rule is a sentence about the form's behaviour, and it was being shown as a data
 * structure. `lib/forms/rule-sentence.ts` owns the wording, because what a rule SAYS is a
 * decision about language and belongs where it can be tested as one, rather than mixed into
 * markup.
 *
 * ## Why it borrows the step's question list
 *
 * The look is `components/forms/step-editor.tsx`'s pin grid, down to `.qcms-table`, the
 * visually hidden caption and the `.qcms-cell--drop` columns that fall away at compact
 * width: two lists of the form's parts on two screens of one builder should not be two
 * different kinds of object. Contract §2's test for what may drop is applied the same way -
 * a column that DESCRIBES a row may go, one that identifies it may not.
 *
 * ## What the row carries, and why the row rather than the editor
 *
 * `ruleAnchorId` is on the `<tr>`. A validation entry and a refused publish's work list
 * both link to it, and they have to land on something that exists whether or not anyone is
 * editing: focusing a rule is "show me the one at fault", not "open it". That is also what
 * lets the rules live on their own screen at all - `lib/forms/issues.ts` explains the
 * switching that made `plan/admin-ux-audit.md` §5.5's objection answerable.
 *
 * ## No reorder, deliberately
 *
 * Rules have no order that means anything: `packages/core/src/evaluate-rules.ts` groups them
 * by target and asks `anyRuleTrue`, and the walk that uses them goes over steps in document
 * order rather than over rules. Move up and move down would offer a significance the engine
 * does not have, which is a worse thing to ship than the absence of a control.
 */
export function RulesTable({
  draft,
  library,
  issues,
  onEdit,
  onRemove,
}: {
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  /** The engine's verdict, or an empty list when nothing has checked this draft yet. */
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
            {/* Issues DESCRIBES a rule rather than identifying it, so it is the column that
                may go at compact width - the same call the pin grid makes about Type. */}
            <th scope="col" className="qcms-cell--drop qcms-rulecell--issues">
              {t("forms.rules.column.issues")}
            </th>
            <th scope="col" className="qcms-rulecell--actions">
              <span className="qcms-visually-hidden">{t("forms.rules.column.actions")}</span>
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

  return (
    // `tabIndex={-1}` for the reason the step anchor carries it: a destination rather than a
    // stop, reachable when something sends focus here and never by tabbing past it.
    <tr id={ruleAnchorId(rule.ruleId)} tabIndex={-1} data-rule-id={rule.ruleId}>
      <td>
        <p className="qcms-rule-sentence">
          {sentence.map((segment, index) => (
            <span
              // The index is the key because a sentence is a fixed sequence rendered whole:
              // segments are not reordered, inserted or removed, they are replaced together
              // when the rule changes.
              key={index}
              className={
                segment.kind === undefined ? undefined : `qcms-rule-sentence__${segment.kind}`
              }
            >
              {segment.text}
            </span>
          ))}
        </p>
      </td>
      <td className="qcms-cell--drop qcms-rulecell--issues">
        {/* Silence rather than a zero. An empty verdict and an absent one both arrive here
            as no issues, and this app does not let either claim a rule is clean - the same
            rule the rail's step badges follow. */}
        {mine.length > 0 && (
          <span className="qcms-tag qcms-tag--draft" data-rule-issues={mine.length}>
            {issueCountLabel(mine.length)}
          </span>
        )}
      </td>
      <td className="qcms-rulecell--actions">
        <div className="qcms-rule-actions">
          {/* VISIBLE, not in the menu beside it. A step's row hides its commands because
              pressing the row already does something; a rule's row does nothing, so its
              primary action has to be on the surface rather than one press further away.

              Bare buttons rather than the kit's: the kit's carry the app's 40px control
              height, which is right for a control a screen is about and far too heavy for
              two of them at the end of every row in a list. `.qcms-rule-action` gives them
              the row's own scale and keeps them past the 24px `target-size` floor, which
              is the number the axe sweep enforces. */}
          <button type="button" className="qcms-rule-action" onClick={onEdit}>
            {t("forms.rules.edit")}
          </button>
          <button type="button" className="qcms-rule-action" onClick={onRemove}>
            {t("forms.rules.remove")}
          </button>
        </div>
      </td>
    </tr>
  );
}
