import { OperatorDay } from "@/components/operator-time";
import { t, tPlural } from "@/lib/i18n/en";
import type { QuestionVersion } from "@/lib/questions/types";
import { latestPublishedVersion } from "@/lib/questions/version-rail";

export function QuestionFacts({
  slug,
  createdAt,
  versions,
  selected,
}: {
  readonly slug: string;
  readonly createdAt: string;
  readonly versions: readonly QuestionVersion[];
  readonly selected: number;
}) {
  const published = latestPublishedVersion(versions);
  const digest =
    published === null
      ? tPlural("questions.rail.digestNoneOne", "questions.rail.digestNone", versions.length)
      : tPlural("questions.rail.digestOne", "questions.rail.digest", versions.length, {
          version: published,
        });
  const type = versions.find((version) => version.version === selected)?.definition.type;

  return (
    <div className="qcms-question-facts" data-testid="qcms-question-facts">
      <dl className="qcms-question-facts__list">
        <dt>{t("questions.detail.slug")}</dt>
        <dd className="qcms-question-facts__slug">{slug}</dd>
        <dt>{t("questions.detail.created")}</dt>
        <dd>
          <OperatorDay iso={createdAt} />
        </dd>
        {type !== undefined && (
          <>
            <dt>{t("questions.detail.type")}</dt>
            <dd>{t(`questions.type.${type}`)}</dd>
          </>
        )}
      </dl>
      <p className="qcms-question-facts__digest">{digest}</p>
    </div>
  );
}
