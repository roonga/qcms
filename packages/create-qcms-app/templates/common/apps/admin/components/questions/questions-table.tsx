"use client";

import { useRouter } from "next/navigation";

import { Table, type TableColumn, type TableRow } from "@/components/kit";
import { t } from "@/lib/i18n/en";

/**
 * The library list table (task 032; wireframe "list `table`").
 *
 * The vendored `Table` carries string cells only (`data` is `Record<string, string>`),
 * which rules out putting a link inside a row and makes `onRowAction` the navigation.
 * That is a real trade and it is taken deliberately: ADR-22 allows exactly one component
 * stack, and hand-rolling a second table here to gain an anchor would be the first brick
 * of the second design language that rule exists to prevent. react-aria makes the row
 * itself the control, so it is focusable and activates on Enter - the wireframe's a11y
 * requirement ("row action reachable by keyboard") is met; what is lost is
 * open-in-new-tab and operation with JavaScript off, both of which this authoring screen
 * can afford and neither of which the credential screens gave up (task 031).
 *
 * String cells are also why the status is rendered as its plain word here rather than as
 * the `StatusTag` used on the detail screen. It reads the same to a screen reader, which
 * is the property that matters.
 */
export function QuestionsTable({
  rows,
  columns,
}: {
  readonly rows: readonly TableRow[];
  readonly columns: readonly TableColumn[];
}) {
  const router = useRouter();
  return (
    <div className="qcms-table">
      <Table
        ariaLabel={t("questions.table.label")}
        columns={[...columns]}
        rows={[...rows]}
        onRowAction={(id) => {
          router.push(`/questions/${encodeURIComponent(id)}`);
        }}
      />
    </div>
  );
}
