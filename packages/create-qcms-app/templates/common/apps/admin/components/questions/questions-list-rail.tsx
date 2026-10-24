import Link from "next/link";

import { Select, TextField } from "@/components/kit";
import { activeFilterCount, RailFilters } from "@/components/rail-filters";
import { RailCount, RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { LIBRARY_SEARCH_MAX_LENGTH } from "@/lib/library-search";
import type { QuestionListFilters } from "@/lib/questions/list-filters";
import { QUESTION_TYPES } from "@/lib/questions/types";

/**
 * The question library's parts of the one rail (`plan/admin-design-contracts.md` §7.0,
 * Code Owner 2026-10-24; issue #1117).
 *
 * §7.0's table gives this screen a Header, no Sections, three Filters and one Action, and
 * that is the whole of this file:
 *
 * - **Header:** "Questions". A top-level screen, so no back link, and no status to tag.
 *   Below `--bp-sidebar` it carries the active filter count, which is what tells a reader
 *   looking at a shut rail that the list under it is narrowed.
 * - **Sections:** none. A row per question would be the rail repeating the page's own body,
 *   which `plan/admin-ux-audit.md` §5.4 rejects: "now there are two of them and they can
 *   disagree".
 * - **Filters:** Search, Status, Type, in the ruled order (Search, status, type or other,
 *   then sort - this list has no sort).
 * - **Actions:** New question, which is structural. The content column's own link stays:
 *   it is the one the empty library offers and the one an author reaches from the table.
 *
 * ## Why the controls are the same elements they were in the toolbar
 *
 * They are the vendored kit's `TextField` and `Select`, which serialize into native inputs,
 * so the GET form around them submits without a handler. Moving a column is not a reason to
 * rebuild a control, and the two libraries' filters read the same because they are the same
 * components in the same order (`components/forms/forms-list-rail.tsx` is the sibling).
 *
 * A server component. Which filters are set is a fact about the address, so it arrives as a
 * prop from the slot that read it - the same `readQuestionListFilters` the page read - and
 * nothing here waits for hydration.
 */
export function QuestionsListRail({ filters }: { readonly filters: QuestionListFilters }) {
  const { status, type, search, activeCount } = filters;

  return (
    <RailFrame
      subject={t("questions.title")}
      title={t("questions.title")}
      testId="qcms-questions-rail"
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
            // The API caps the term at the same number and answers 400 past it
            // (issues #686, #862); this stops the author there instead.
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
        // An anchor, because it navigates rather than acts, wearing the same treatment the
        // form rail's Add step link wears on the seven screens where that one navigates
        // too. A reader moving between screens should not see the rail's last control
        // change shape.
        <Link href="/questions/new" className="qcms-rail__action-link">
          {t("questions.new")}
        </Link>
      }
    />
  );
}
