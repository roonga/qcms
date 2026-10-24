"use client";

import { QuestionRailIssueCount } from "@/components/questions/rail-issue-count";
import { RailFrame } from "@/components/rail-frame";
import { t, tPlural } from "@/lib/i18n/en";
import { useQuestionPanels } from "@/lib/questions/editor-bridge";
import type { QuestionPanel } from "@/lib/questions/panels";

/**
 * The creation screen's parts of the one rail (`plan/admin-design-contracts.md` §7.0,
 * Code Owner 2026-10-24; issue #1117).
 *
 * §7.0's table: "New question | back to Questions, New question | Content, Constraints
 * (Options for choice types) | - | -". So a Header with the way back, Sections that are the
 * document's own panels, and nothing else.
 *
 * ## Why the Sections are fragment anchors and not `?panel=`
 *
 * This screen renders EVERY panel at once, stacked in one card, and switches nothing - which
 * is the one thing about it the panel work deliberately left alone, because an author
 * creating a question is filling all of it in rather than returning to one part of it. So
 * each `<section id={panel.anchorId}>` is already in the document, and a row is an ordinary
 * same-page link to it: the browser scrolls, and on a long choice question that is the whole
 * value of these rows.
 *
 * **No handler, and no `preventDefault`**, which is the opposite of what the detail rail's
 * panel rows do (`components/questions/question-panel-rows.tsx` records why they prevent it).
 * The two are different acts. There, a row SWITCHES which panel the column shows, and letting
 * the browser navigate would take focus off the row a keyboard reader just pressed. Here a
 * row is a jump to a section that is already on screen, and moving focus to the section the
 * reader asked for is the correct behaviour rather than a side effect - the section carries
 * `tabIndex={-1}`, so they land inside the part they chose and carry on tabbing from there.
 *
 * **No `aria-current` either.** Nothing on this screen is selected: every panel is shown.
 * §7.0's "exactly one row reads as selected" is a rule about a rail that has a selection,
 * and claiming one here would mark a row for a state the screen does not have.
 *
 * ## Why it is a client component, which the other new-screen rail is not
 *
 * Because which panels exist depends on the document being typed, not on the address. The
 * type is chosen on this screen (it is the only screen where it can be), and changing it
 * changes the list: a single choice gains Options, a boolean gains Yes and no labels and
 * loses Constraints. The editor publishes its live panels through
 * `lib/questions/editor-bridge.ts` and this reads them, so the rows follow the document -
 * "9 options" a keystroke after "8 options", the same way the detail rail's rows do.
 *
 * The `panels` prop is what makes the FIRST paint right without waiting for that: the slot
 * derives the same list on the server from the blank document this screen opens with, which
 * is what every panel row in this app does rather than render an empty rail and fill it in.
 *
 * The Header's count is the shared island, for the same reason the detail rail's is: the
 * issue total is the live document's, so a refused save on this screen names its total in
 * the one line a reader sees below `--bp-sidebar`.
 */
export function NewQuestionRail({ panels }: { readonly panels: readonly QuestionPanel[] }) {
  const live = useQuestionPanels();
  const rows = live?.panels ?? panels;
  const counts = live?.issueCounts;

  return (
    <RailFrame
      subject={t("questions.create.title")}
      back={{ href: "/questions", label: t("questions.title") }}
      title={t("questions.create.title")}
      testId="qcms-new-question-rail"
      count={<QuestionRailIssueCount />}
      sections={
        /* An unordered list with the same name the detail rail's panel list carries, and the
           same row chrome: a `.qcms-rail__link--stacked` with the panel's name, its issue
           badge and its digest underneath. A reader who has used the detail screen's rail
           should not have to learn a second kind of row here. */
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
                  data-rail-panel={panel.id}
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
      }
    />
  );
}
