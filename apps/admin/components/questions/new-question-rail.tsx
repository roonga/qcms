"use client";

import { QuestionRailIssueCount } from "@/components/questions/rail-issue-count";
import { RailFrame } from "@/components/rail-frame";
import { t, tPlural } from "@/lib/i18n/en";
import { useQuestionPanels } from "@/lib/questions/editor-bridge";
import type { QuestionPanel } from "@/lib/questions/panels";

/**
 * The creation screen's rail: the way back, and the document's panels as Sections
 * (`plan/admin-design-contracts.md` §7.0).
 *
 * A client component because the type is chosen on this screen and decides which panels
 * exist; `panels` is the server's answer for the first paint. The rows are plain fragment
 * anchors: every panel is on screen, so a row scrolls rather than switching, and none is
 * `aria-current`.
 */
export function NewQuestionRail({ panels }: { readonly panels: readonly QuestionPanel[] }) {
  const live = useQuestionPanels();
  const rows = live?.panels ?? panels;
  const counts = live?.issueCounts;

  return (
    <RailFrame
      subject={t("questions.create.title")}
      back={{ href: "/questions", label: t("questions.title") }}
      title={t("questions.create.title")}
      testId="qcms-new-question-rail"
      count={<QuestionRailIssueCount />}
      sections={
        // No `--panels` modifier: it indents rows nested under a version row, and these are
        // the top-level Sections.
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
      }
    />
  );
}
