"use client";

import { t, tPlural } from "@/lib/i18n/en";
import {
  chooseQuestionPanel,
  useQuestionPanel,
  useQuestionPanels,
} from "@/lib/questions/editor-bridge";
import type { QuestionPanel, QuestionPanelId } from "@/lib/questions/panels";

/* Prevent native fragment focus so activating panel navigation keeps keyboard focus on the rail row. */
export function QuestionPanelRows({
  panels,
  selected,
}: {
  readonly panels: readonly QuestionPanel[];
  readonly selected: QuestionPanelId;
}) {
  const live = useQuestionPanels();
  const rows = live?.panels ?? panels;
  const counts = live?.issueCounts;
  const open = useQuestionPanel(selected);

  return (
    <ul
      className="qcms-rail__group qcms-rail__group--panels"
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
              // Only the open question panel is mounted, so aria-controls cannot name ids for every panel row.
              aria-current={panel.id === open ? "page" : undefined}
              data-rail-panel={panel.id}
              // Prevent native fragment navigation: its focusable target would take focus away from the rail row.
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                chooseQuestionPanel(panel.id);
                const url = new URL(window.location.href);
                url.hash = panel.anchorId;
                window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
              }}
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
}
