import Link from "next/link";
import type { ReactNode } from "react";

import { OperatorDay } from "@/components/operator-time";
import { PublishedOnDay } from "@/components/questions/published-on-day";
import { QuestionPanelRows } from "@/components/questions/question-panel-rows";
import { QuestionRailIssueCount } from "@/components/questions/rail-issue-count";
import { StatusTag } from "@/components/questions/status-tag";
import { RailFrame } from "@/components/rail-frame";
import { t, tPlural } from "@/lib/i18n/en";
import type { QuestionPanel, QuestionPanelId } from "@/lib/questions/panels";
import type { QuestionVersion } from "@/lib/questions/types";
import { latestPublishedVersion, versionRailItems } from "@/lib/questions/version-rail";

export function QuestionVersionsRail({
  questionId,
  slug,
  createdAt,
  versions,
  selected,
  panels,
  panel,
  actions,
}: {
  readonly questionId: string;
  readonly slug: string;
  readonly createdAt: string;
  readonly versions: readonly QuestionVersion[];
  readonly selected: number;
  readonly panels: readonly QuestionPanel[];
  readonly panel: QuestionPanelId;
  readonly actions?: ReactNode;
}) {
  const items = versionRailItems(questionId, versions, selected);
  const published = latestPublishedVersion(versions);
  const digest =
    published === null
      ? tPlural("questions.rail.digestNoneOne", "questions.rail.digestNone", versions.length)
      : tPlural("questions.rail.digestOne", "questions.rail.digest", versions.length, {
          version: published,
        });
  const selectedVersion = versions.find((version) => version.version === selected);
  const type = selectedVersion?.definition.type;

  return (
    <RailFrame
      subject={questionId}
      context={{ href: "/questions", label: t("rail.allQuestions") }}
      label={<span className="qcms-rail__id">{questionId}</span>}
      testId="qcms-question-rail"
      count={<QuestionRailIssueCount />}
      {...(selectedVersion === undefined
        ? {}
        : { tag: <StatusTag status={selectedVersion.status} /> })}
      {...(actions === undefined ? {} : { actions })}
      lines={
        <>
          <dl className="qcms-rail__facts">
            <dt>{t("questions.detail.slug")}</dt>
            <dd className="qcms-rail__facts-slug">{slug}</dd>
            <dt>{t("questions.detail.created")}</dt>
            <dd>
              <OperatorDay iso={createdAt} />
            </dd>
            {type !== undefined && (
              <>
                <dt>{t("questions.detail.type")}</dt>
                <dd>{t("questions.detail.typeLocked", { type: t(`questions.type.${type}`) })}</dd>
              </>
            )}
          </dl>
          <p className="qcms-rail__sub qcms-rail__digest">{digest}</p>
        </>
      }
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
