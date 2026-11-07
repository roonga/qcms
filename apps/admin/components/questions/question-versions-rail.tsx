import Link from "next/link";
import type { ReactNode } from "react";

import { PublishedOnDay } from "@/components/questions/published-on-day";
import { QuestionPanelRows } from "@/components/questions/question-panel-rows";
import { QuestionRailIssueCount } from "@/components/questions/rail-issue-count";
import { StatusTag } from "@/components/questions/status-tag";
import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import type { QuestionPanel, QuestionPanelId } from "@/lib/questions/panels";
import type { QuestionVersion } from "@/lib/questions/types";
import { versionRailItems } from "@/lib/questions/version-rail";

export function QuestionVersionsRail({
  questionId,
  versions,
  selected,
  panels,
  panel,
  actions,
}: {
  readonly questionId: string;
  readonly versions: readonly QuestionVersion[];
  readonly selected: number;
  readonly panels: readonly QuestionPanel[];
  readonly panel: QuestionPanelId;
  readonly actions?: ReactNode;
}) {
  const items = versionRailItems(questionId, versions, selected);

  return (
    <RailFrame
      subject={questionId}
      context={{ href: "/questions", label: t("rail.allQuestions") }}
      label={<span className="qcms-rail__id">{questionId}</span>}
      testId="qcms-question-rail"
      count={<QuestionRailIssueCount />}
      {...(actions === undefined ? {} : { actions })}
      sections={
        <ul
          className="qcms-rail__group"
          aria-label={t("questions.detail.versions")}
          data-rail-group="versions"
        >
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="qcms-rail__link qcms-rail__link--stacked"
                data-rail-item={item.key}
                data-rail-version={item.version}
                {...(item.isCurrent ? { "aria-current": "page" as const } : {})}
              >
                <span className="qcms-rail__row">
                  <span>{t("questions.detail.version", { version: item.version })}</span>
                  <StatusTag status={item.status} />
                </span>
                <span className="qcms-rail__sub">
                  {item.publishedAt === null ? (
                    t("questions.detail.unpublished")
                  ) : (
                    <PublishedOnDay iso={item.publishedAt} />
                  )}
                </span>
              </Link>
              {item.isCurrent && panels.length > 0 && (
                <QuestionPanelRows panels={panels} selected={panel} />
              )}
            </li>
          ))}
        </ul>
      }
    />
  );
}
