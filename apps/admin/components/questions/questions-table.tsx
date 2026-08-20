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
 *
 * ## The trade above is now on notice
 *
 * `plan/admin-design-contracts.md` §2 (CONFIRMED 2026-08-20) settles it the other way:
 * the row's identifying cell carries a real anchor, and whole-row `onRowAction` retires
 * with the kit-table migration. Issue 514 brought this table into the one `qcms-table`
 * family visually - the row height, header, padding and dividers below are the same
 * treatment every other table in the app now uses - and left the row action alone,
 * because retiring it is a behaviour change with its own no-JS and keyboard evidence to
 * produce and does not belong buried in a restyle. `qcms-table--rowaction` is the marker
 * for what is left to do: it exists only on the tables whose whole row is still the
 * control, and it is deleted when the last one gains its anchor.
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
    <div className="qcms-table qcms-table--rowaction qcms-table--questions">
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
