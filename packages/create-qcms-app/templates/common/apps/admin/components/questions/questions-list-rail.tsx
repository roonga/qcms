import Link from "next/link";

import { Select, TextField } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { LIBRARY_SEARCH_MAX_LENGTH } from "@/lib/library-search";
import type { QuestionListFilters } from "@/lib/questions/list-filters";
import { QUESTION_TYPES } from "@/lib/questions/types";

/**
 * The question library's rail: a Header, three Filters and the creating action
 * (`plan/admin-design-contracts.md` §7.0).
 *
 * No Sections: a row per question would repeat the table beside it.
 */
export function QuestionsListRail({ filters }: { readonly filters: QuestionListFilters }) {
  const { status, type, search, activeCount } = filters;

  return (
    <RailFrame
      subject={t("questions.title")}
      title={t("questions.title")}
      testId="qcms-questions-rail"
      filterCount={activeCount}
      {...(activeCount > 0
        ? { count: <RailCount>{activeFilterCount(activeCount)}</RailCount> }
        : {})}
      filters={
        <RailFilters activeCount={activeCount} clearHref="/questions">
          <TextField
            name="q"
            label={t("questions.filter.search")}
            description={t("questions.filter.searchHint")}
            defaultValue={search}
            // The API answers 400 past this length.
            maxLength={LIBRARY_SEARCH_MAX_LENGTH}
          />
          <Select
            name="status"
            label={t("questions.filter.status")}
            defaultValue={status ?? ""}
            placeholder={t("questions.filter.statusAll")}
            items={[
              { label: t("questions.filter.statusAll"), value: "" },
              { label: t("questions.status.draft"), value: "draft" },
              { label: t("questions.status.published"), value: "published" },
              { label: t("questions.status.deprecated"), value: "deprecated" },
            ]}
          />
          <Select
            name="type"
            label={t("questions.filter.type")}
            defaultValue={type ?? ""}
            placeholder={t("questions.filter.typeAll")}
            items={[
              { label: t("questions.filter.typeAll"), value: "" },
              ...QUESTION_TYPES.map((value) => ({
                label: t(`questions.type.${value}`),
                value,
              })),
            ]}
          />
        </RailFilters>
      }
      actions={
        <Link href="/questions/new" className="qcms-rail__action-link">
          {t("questions.new")}
        </Link>
      }
    />
  );
}
