"use client";

import { t, tPlural } from "@/lib/i18n/en";
import {
  chooseQuestionPanel,
  useQuestionPanel,
  useQuestionPanels,
} from "@/lib/questions/editor-bridge";
import type { QuestionPanel, QuestionPanelId } from "@/lib/questions/panels";

/**
 * The editor's panels, as rows nested under the selected version (Code Owner, 2026-09-27).
 *
 * ## What these rows are, and which of the three rails they behave like
 *
 * `components/forms/rail-steps.tsx` and `components/settings-section-rail.tsx` are the two
 * precedents and this sits between them. Like the builder's step rows, these are the CHILDREN
 * of the row above them and they carry a digest and an issue badge that come from a live
 * client document. Like the Settings rail's rows, what they switch is a panel of the one route
 * the reader is already standing on rather than an address they could open elsewhere.
 *
 * So they are **buttons**, which is the rule rather than an exception to it
 * (`docs/admin-constraints.md`: an anchor navigates, a button acts). Choosing Constraints
 * changes what the column beside the rail is showing; there is nothing to open in a new tab.
 * The version rows they nest under stay anchors for the same rule read the other way: a version
 * is a different address (`?v=3`) and middle-clicking one has to work.
 *
 * **The admin requires JavaScript** (Code Owner, 2026-09-27), so there is no fallback here and
 * none is wanted. Nothing renders a dead anchor for a reader who has none. That is a property
 * of the app rather than a concession this component negotiated: the Settings rail already
 * switches its panels the same way, and `docs/admin-constraints.md` puts the POCs in charge of
 * the design.
 *
 * ## Why the rows exist before the editor has published anything
 *
 * The slot resolved the selected version's definition in order to render the rail at all, so it
 * derives the same panels from the same functions the editor does and hands them in as
 * `panels`. That makes the first paint right without a round trip and without a guess: the row
 * the address names is already the marked one, because both trees read `?panel=` through
 * `panelFromParams`. Once the editor publishes (`lib/questions/editor-bridge.ts`) the rows take
 * its live list instead, so a digest follows the document as it is typed rather than the last
 * save - add an option and "8 options" becomes "9 options" here.
 *
 * ## The builder's classes, on the builder's instruction
 *
 * **Code Owner, 2026-09-27: this rail wears the form builder's styling.** So a panel row is a
 * `.qcms-rail__link` with `data-rail-item`, the list is a `.qcms-rail__group` with
 * `data-rail-group`, and the badge is the same `.qcms-tag--draft` count the builder's step rows
 * carry. `data-rail-group` also opts this list into the builder's marker treatment - a tint and
 * a heavier weight, no accent edge - which is the right answer for a nested tree where a parent
 * row and a child row are both current at once, and which is why the rule exists there.
 */
export function QuestionPanelRows({
  panels,
  selected,
}: {
  /** The panels the server derived from the selected version's stored definition. */
  readonly panels: readonly QuestionPanel[];
  /** The panel the address names, resolved by `panelFromParams` on the server. */
  readonly selected: QuestionPanelId;
}) {
  const live = useQuestionPanels();
  const rows = live?.panels ?? panels;
  const counts = live?.issueCounts;
  const open = useQuestionPanel(selected);

  return (
    // A list rather than loose rows, and named, because a screen reader walking this rail
    // otherwise meets a second unlabelled list inside the version list and has nothing to tell
    // them apart. `aria-label` rather than a heading, for the reason the whole rail carries
    // none: it renders before `<main>`, so a heading here would sit above the screen's `<h1>`.
    <ul
      className="qcms-rail__group qcms-question-rail__panels"
      aria-label={t("questions.rail.panels")}
      data-rail-group="panels"
    >
      {rows.map((panel) => {
        const issueCount = counts?.get(panel.id) ?? 0;
        return (
          <li key={panel.id}>
            <button
              type="button"
              className="qcms-rail__link qcms-rail__link--stacked qcms-question-rail__panel"
              data-rail-item={`panel:${panel.id}`}
              // NO `aria-controls`, and that is a correction rather than an omission. The
              // Settings rail's rows carry one, because that screen renders all three of its
              // panels and hides the two it is not showing - so every id a row names is in the
              // document. This editor renders ONE panel, so four of the five ids would point at
              // nothing, which `aria-valid-attr-value` reports as an invalid attribute value in
              // every mode (caught by `e2e/a11y-axe.pw.ts`, and it is right to: an
              // `aria-controls` that resolves to nothing is a promise to an assistive technology
              // that the document cannot keep).
              //
              // Nothing is lost by dropping it. `aria-current="page"` is the whole of the
              // accessible statement about which panel is open, set by React from the same value
              // the panel renders from, so a screen reader hears it on the row it just activated.
              // `panelAnchorId` still mints the section's id, because the refused-save path looks
              // the open panel up by it to move focus inside.
              aria-current={panel.id === open ? "page" : undefined}
              data-rail-panel={panel.id}
              onClick={() => {
                chooseQuestionPanel(panel.id);
              }}
            >
              <span className="qcms-rail__row">
                <span>{panel.label}</span>
                {issueCount > 0 && (
                  // The builder's step badge, on the same tag and with the same rule behind it:
                  // a count appears only ABOVE zero, so a rail with no refusal behind it has no
                  // all-clear to fabricate. `qcms-tag--draft` is the amber the builder's
                  // per-step counts wear, which is what makes the two read as one device.
                  <span className="qcms-tag qcms-tag--draft" data-rail-issues={issueCount}>
                    {tPlural("questions.rail.issuesOne", "questions.rail.issues", issueCount)}
                  </span>
                )}
              </span>
              {/* The digest, under the name, where a version row puts its published date: the
                  two kinds of row in this rail then have the same two-line shape rather than
                  one being a line and the other a block. `.qcms-rail__sub` is that one
                  treatment, shared with the version rows. */}
              <span className="qcms-rail__sub">{panel.digest}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
