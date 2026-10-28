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
 * They were **buttons**, on the rule that an anchor navigates and a button acts
 * (`docs/admin-constraints.md`), because choosing Constraints changes what the column beside
 * the rail is showing rather than going anywhere. **§7.0 ruling 2.2 reverses that for rail
 * rows specifically: "anchors to the subject's routes or same-page panels ... Never
 * buttons"** (issue #1116). One rail with one kind of row is the point: an operator should
 * not have to learn which rows of a rail can be middle-clicked.
 *
 * So a row is an anchor onto the panel's own section id - `panel.anchorId`, the id the editor
 * already puts on the open panel and the id the refused-save path moves focus to. One value
 * for the row's `href` and the editor's anchor, rather than two that have to be kept equal.
 *
 * **What switches the panel is the click, and the address the switch writes is still
 * `?panel=`.** `chooseQuestionPanel` replaces that parameter (`lib/questions/editor-bridge.
 * ts`), which is what a reload and the server read, and the handler writes the fragment beside
 * it so the whole address names the open panel.
 *
 * A row opened in a new tab arrives on the panel the ADDRESS names, not on the row's own: the
 * `href` is a bare fragment, so a modified click carries whatever `?panel=` the URL already
 * has. Same limit the paragraph below records for a cold load.
 *
 * **THE DEFAULT IS PREVENTED, AND FOCUS IS THE REASON.** It was not, on the reasoning that the
 * fragment should land in the bar by itself and the browser's scroll-into-view was harmless.
 * The scroll was; the focus was not. The editor's panel section carries `tabIndex={-1}`, because
 * it is where a refused save sends the author, so a same-page fragment navigation to it is a
 * navigation to a FOCUSABLE element and the browser moves focus off the row. A reader walking
 * the rail by keyboard pressed Enter on Constraints and landed in the panel, which is both the
 * wrong place to continue from and a silent difference from the Settings rail, whose rows keep
 * focus because the panels they name are ordinary `<div>`s and take none. Preventing the default
 * and writing the fragment with `replaceState` makes the two rails behave alike: the address
 * carries the fragment, the panel switches, and focus stays on the row the reader pressed
 * (`e2e/questions-rail.pw.ts`, which is where this is asserted - jsdom performs no fragment
 * navigation, so only a browser can see it).
 *
 * What the fragment does NOT do is select a panel on a cold load: the editor renders one panel
 * at a time, so four of the five ids are not in the document, and a reader arriving on
 * `#panel-constraints` alone gets the panel `?panel=` names. That is the honest limit of a
 * fragment on a screen that renders one section, and the parameter is what the screen's own
 * address contract has always been. **The admin requires JavaScript** (Code Owner, 2026-09-27;
 * the standing correction of 2026-08-22 records that there is no no-JS requirement here), so
 * the click handler is the whole mechanism rather than an enhancement over one.
 *
 * The version rows these nest under are anchors too, and were already: a version is a
 * different address (`?v=3`).
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
 * carry.
 *
 * `data-rail-group` used to carry a second meaning here: it opted a list into the form rail's
 * marker treatment, which removed the accent edge from every current row in a tree. §7.0 ruling
 * 2 replaced that with one mark for every rail and a demoted PARENT row, so the attribute means
 * only what it says - this is a group of rail rows - and the nesting is what the stylesheet
 * reads (issue #1116).
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
              // PREVENTED, so the fragment lands without a navigation: the panel this names
              // is a `tabIndex={-1}` focus destination for a refused save, so letting the
              // browser navigate to it would take focus off the row a keyboard reader just
              // pressed. The docblock above records that at length.
              //
              // `replaceState` rather than a push, and after `chooseQuestionPanel`, which has
              // just replaced `?panel=`: reading `location` back here picks that up, so the
              // two write one entry between them. The panels are one screen's worth of one
              // question, not five places the reader went.
              //
              // Not prevented for a modified or non-primary click: the browser's default
              // opens a tab, which is what the Settings rail's plain anchors already do, and
              // one rail should not have two kinds of row. A keyboard Enter reports button 0.
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                chooseQuestionPanel(panel.id);
                const url = new URL(window.location.href);
                url.hash = panel.anchorId;
                window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
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
            </a>
          </li>
        );
      })}
    </ul>
  );
}
