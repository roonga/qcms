"use client";

import { QuestionRailIssueCount } from "@/components/questions/rail-issue-count";
import { RailFrame, RailTree } from "@/components/rail-frame";
import { t, tPlural } from "@/lib/i18n/en";
import { useQuestionPanels } from "@/lib/questions/editor-bridge";
import type { QuestionPanel } from "@/lib/questions/panels";
import { questionsRailItems } from "@/lib/shell/area-rails";

export function NewQuestionRail({ panels }: { readonly panels: readonly QuestionPanel[] }) {
  const live = useQuestionPanels();
  const rows = live?.panels ?? panels;
  const counts = live?.issueCounts;

  const panelRows = (
    <ul
      className="qcms-rail__group"
      aria-label={t("questions.rail.panels")}
      data-rail-group="panels"
    >
      {rows.map((panel) => {
        const issueCount = counts?.get(panel.id) ?? 0;
        return (
          <li key={panel.id}>
            <a
              href={`#${panel.anchorId}`}
              className="qcms-rail__link qcms-rail__link--stacked"
              data-rail-item={`panel:${panel.id}`}
              data-rail-panel={panel.id}
            >
              <span className="qcms-rail__row">
                <span>{panel.label}</span>
                {issueCount > 0 && (
                  <span className="qcms-tag qcms-tag--draft" data-rail-issues={issueCount}>
                    {tPlural("questions.rail.issuesOne", "questions.rail.issues", issueCount)}
                  </span>
                )}
              </span>
              <span className="qcms-rail__sub">{panel.digest}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );

  return (
    <RailFrame
      subject={t("questions.title")}
      testId="qcms-new-question-rail"
      count={<QuestionRailIssueCount />}
      sections={
        <RailTree
          items={questionsRailItems("new").map((item) =>
            item.current ? { ...item, expanded: true, children: panelRows } : item,
          )}
        />
      }
    />
  );
}
