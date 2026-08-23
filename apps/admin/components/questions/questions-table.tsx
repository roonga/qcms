import Link from "next/link";

import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";
import type { QuestionListItem } from "@/lib/questions/types";

/**
 * The library list table (task 032; screen contract "list `table`").
 *
 * ## The row was the control, and is not any more (issue 570)
 *
 * What stood here recorded a trade taken in task 032: the vendored kit `Table` carries
 * string cells only (`data` is `Record<string, string>`), so a row could not hold an
 * anchor, so the whole row became the control through `onRowAction` and a
 * `useRouter().push`. ADR-22's single-stack rule was the reason for not hand-rolling a
 * table to get around it, and what the trade cost was named honestly at the time:
 * open-in-new-tab, and operation with JavaScript off.
 *
 * `plan/admin-design-contracts.md` §2 (CONFIRMED 2026-08-20) settles it the other way:
 *
 * > the row's identifying cell carries a real anchor (open-in-new-tab and no-JS work);
 * > whole-row `onRowAction` click is retired with the kit-table migration.
 *
 * So the markup is hand-authored now, and the ADR-22 worry the old note raised does not
 * apply to it. A second design language was the risk, and there is no second language to
 * join: issue 514 made `qcms-table` the app's one table treatment for hand-authored and
 * kit-rendered markup alike, six of the app's tables were already hand-authored inside
 * it, and this table joins them wearing the same class and the same cell modifiers. The
 * stylesheet said as much before this change landed, next to the positional rules that
 * are now gone: "when §2's row-action clause retires `onRowAction` their markup becomes
 * hand-authored".
 *
 * Three things follow that the kit table could not give:
 *
 *  - The component is no longer a client component. Navigation is an `<a href>`, so there
 *    is no router to reach for, and the server HTML this page emits carries the route to
 *    every question in it. That is the no-JS requirement, met by construction.
 *  - Cells take a `className`, so the numeric columns opt in as columns
 *    (`qcms-cell--num`) instead of by `nth-child` index, and the compact-width drops §2
 *    requires of every table become expressible here at all.
 *  - The status could go back to being a `StatusTag`. It deliberately does not, in this
 *    change: the word reads identically to a screen reader, the tag is a visual decision
 *    with its own frames to shoot, and this issue is a navigation change.
 *
 * ## Which columns drop at compact width (§2)
 *
 * The test issue 515 established and issue 514 applied to the other six tables: a column
 * that IDENTIFIES a row stays, a column that merely DESCRIBES one drops.
 *
 *  - **ID** and **Label** identify. They are how an author recognises the row they came
 *    looking for, and the ID is the anchor.
 *  - **Latest** is the Version column, and the Version column never drops anywhere
 *    (`plan/admin-mobile-stance.md`, item 5).
 *  - **Status** stays, and it is the one judgement call here. It describes rather than
 *    identifies, but it decides what an author can do with the row next: a draft can be
 *    edited and a published version cannot (R1). Dropping it would hide the difference
 *    between a row that is editable and one that is frozen, on the width where an author
 *    is least able to afford a wasted navigation.
 *  - **Type** and **Created** describe, and neither survives being read at 390px as a
 *    reason to open a row. Both drop.
 *
 * No `min-inline-size` is declared here, so there is none to reset at the boundary: with
 * Type and Created gone the remaining four fit, and the family's scroll container stays
 * the fallback rather than the default experience, which is what §2 asks for.
 */
export function QuestionsTable({ rows }: { readonly rows: readonly QuestionListItem[] }) {
  return (
    <div className="qcms-table qcms-table--questions">
      <table data-testid="qcms-questions-table">
        <caption className="qcms-visually-hidden">{t("questions.table.label")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("questions.column.id")}</th>
            <th scope="col">{t("questions.column.label")}</th>
            <th scope="col" className="qcms-cell--drop">
              {t("questions.column.type")}
            </th>
            <th scope="col" className="qcms-cell--num">
              {t("questions.column.version")}
            </th>
            <th scope="col">{t("questions.column.status")}</th>
            <th scope="col" className="qcms-cell--num qcms-cell--drop">
              {t("questions.column.created")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((question) => (
            <tr key={question.questionId} data-question-id={question.questionId}>
              <th scope="row">
                <Link
                  className="qcms-text-link"
                  href={`/questions/${encodeURIComponent(question.questionId)}`}
                  aria-label={t("questions.open", { questionId: question.questionId })}
                >
                  <code className="qcms-link-id">{question.questionId}</code>
                </Link>
              </th>
              <td>{textOf(question.label ?? undefined)}</td>
              {/* A row whose latest version has gone missing has no type to name; an em
                  dash is not available and a blank cell reads as "none", so say it in
                  words. */}
              <td className="qcms-cell--drop">
                {question.type === null
                  ? t("questions.column.typeUnknown")
                  : t(`questions.type.${question.type}`)}
              </td>
              <td className="qcms-cell--num">v{question.latestVersion}</td>
              <td>{t(`questions.status.${question.latestStatus}`)}</td>
              <td className="qcms-cell--num qcms-cell--drop">{isoDay(question.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** ISO day. Formatted on the server so the client renders the identical string. */
function isoDay(timestamp: string): string {
  return timestamp.slice(0, 10);
}
