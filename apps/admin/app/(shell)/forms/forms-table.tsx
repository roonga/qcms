"use client";

import { useRouter } from "next/navigation";

import { Table, type TableColumn, type TableRow } from "@/components/kit";
import { t } from "@/lib/i18n/en";

/**
 * The form library table (task 033).
 *
 * The same trade 032's `QuestionsTable` records, for the same reason: the vendored `Table`
 * carries string cells only, so a row cannot hold an anchor and `onRowAction` is the
 * navigation. ADR-22 allows exactly one component stack, and hand-rolling a second table
 * here to gain an `<a>` would be the first brick of the second design language that rule
 * exists to prevent. react-aria makes the row itself the control, so it is focusable and
 * activates on Enter; what is lost is open-in-new-tab and operation with JavaScript off,
 * which this authoring screen can afford (the builder needs JavaScript regardless).
 *
 * `plan/admin-design-contracts.md` §2 now settles that trade the other way, and the note
 * on `components/questions/questions-table.tsx` explains what issue 514 did and did not
 * do about it: the visual family arrived, the row action did not retire, and
 * `qcms-table--rowaction` is what marks the tables still waiting on an anchor.
 */
export function FormsTable({
  rows,
  columns,
}: {
  readonly rows: readonly TableRow[];
  readonly columns: readonly TableColumn[];
}) {
  const router = useRouter();
  return (
    <div className="qcms-table qcms-table--rowaction qcms-table--forms">
      <Table
        ariaLabel={t("forms.table.label")}
        columns={[...columns]}
        rows={[...rows]}
        onRowAction={(id) => {
          router.push(`/forms/${encodeURIComponent(id)}`);
        }}
      />
    </div>
  );
}
