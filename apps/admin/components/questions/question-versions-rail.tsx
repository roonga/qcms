import Link from "next/link";
import type { ReactNode } from "react";

import { QuestionPanelRows } from "@/components/questions/question-panel-rows";
import { StatusTag } from "@/components/questions/status-tag";
import { RailDisclosure } from "@/components/rail-disclosure";
import { t, tPlural } from "@/lib/i18n/en";
import { formatDay } from "@/lib/i18n/format";
import type { QuestionPanel, QuestionPanelId } from "@/lib/questions/panels";
import type { QuestionVersion } from "@/lib/questions/types";
import { latestPublishedVersion, versionRailItems } from "@/lib/questions/version-rail";

/**
 * The question detail screen's rail, built to `plan/admin-shell-poc/question-editor-poc.html`
 * (issue 650) and carrying the editor's panel switches since 2026-09-27 (Code Owner).
 *
 * ## A third rail, named distinctly, and not a variant of either of the other two
 *
 * The app now ships three rails that share a column and share nothing else.
 * `components/forms/form-subtree-rail.tsx` navigates between the ROUTES of one form's
 * subtree. `components/settings-section-rail.tsx` switches which PANEL of the single
 * Settings route is on screen. This one does both at once: its version rows are `?v=` on the
 * route the reader is already standing on, and the panel rows nested under the selected one
 * switch which part of that version's editor the column beside the rail is showing. Three
 * different answers to "what does a rail carry", which is why they are three files rather than
 * one component with a flag: a flag would be the seam along which the three contracts get
 * unified, and the next change to any of them would have to be argued as a change to all three.
 *
 * **`components/rail-frame.tsx` is not widened for this.** No base component, no widened
 * props type, no variant flag, no shared module. The `<details>` chrome below is restated
 * rather than taken from `RailFrame`, which is the same trade the Settings rail made.
 *
 * That restatement earned itself when the summary carried a collapsed-only "which version"
 * indicator `RailFrame` had no place for. **The indicator is retired (Code Owner,
 * 2026-09-29)** and the summary is now a text line and nothing else, which is exactly what
 * `RailFrame` takes - so the local copy is down to the digest line under it and the details
 * group, and folding this rail onto `RailFrame` is a smaller change than it was. It is not
 * made here: this branch has moved this screen enough, and a shared-chrome change reaches
 * three rails.
 *
 * ## What it carries, top to bottom
 *
 * The back link, the question's id, the question's own details, the actions on the selected
 * version, the version list, and the selected version's editor panels nested under its row.
 * Four of those six arrived on 2026-09-27 and each has its reason written beside it below. The
 * shape they add up to is the form builder's: the rail is where a reader moves around one
 * thing, and the column beside it shows the one piece they moved to.
 *
 * The version list is still the one group the POC draws, with the lifecycle actions pinned
 * above it, and its reason is unchanged: the version list is the one thing on this screen that
 * grows without bound, so an action anchored below it would drift further down the rail with
 * every version the question accumulates.
 *
 * **A rail here carries actions and same-page switches, and `plan/admin-design-contracts.md`
 * §7 records both as general rules now** rather than as this screen's exception. The clause
 * that forbade them was retired on 2026-08-25.
 *
 * ## The builder's rail is the look, and this file borrows its classes rather than its shape
 *
 * **Code Owner, 2026-09-27: this rail wears the same styling as the form builder's.** So the
 * rows here are `.qcms-rail__link` with `data-rail-item`, the groups are `.qcms-rail__group`
 * with `data-rail-group`, the nested panels sit inside the selected version's `<li>` exactly
 * as the builder's steps sit inside its Form row, the badges are the builder's
 * `.qcms-tag--draft` count, and the lifecycle controls wear `.qcms-rail-steps__add` - the
 * treatment its Add step control already had. Six classes went with that change and the
 * stylesheet says which; what is left of `qcms-question-rail__*` is the four things this rail
 * has and the builder does not: the mono question id in its summary, the digest line above the
 * version list, the details group, and the back link above the disclosure. (There were five
 * until 2026-09-29, when the collapsed-only version indicator was retired: the screen's `<h1>`
 * names the version now, one row under the summary, so at 390 the two said the same thing.)
 *
 * The visible "VERSIONS / 3 versions, v2 published" header row went with them. The builder
 * names a group with `aria-label` on the list rather than with a visible heading, and the
 * digest is what `RailFrame` puts in the summary as a count tag - so that is where it is now.
 *
 * ## Anchors for the versions, buttons for the panels and the actions
 *
 * Which version is selected and which panel is open are both facts about the address, so both
 * arrive as props rather than being read from the browser. A version row is an anchor because
 * it goes to another address and open-in-new-tab has to work; the panel rows and the lifecycle
 * controls are buttons because they act on the version already on screen
 * (`docs/admin-constraints.md`: an anchor navigates, a button acts).
 *
 * This component stays a **server** component: the panel rows are a client child and the
 * actions arrive as a slot, so the version list, the details and the back link are resolved
 * once, on the server, from the address. That buys a correct FIRST PAINT rather than reach -
 * the admin requires JavaScript (Code Owner, 2026-09-27) - and it is what lets the marked row
 * and the rendered panel agree before anything has hydrated.
 */
export function QuestionVersionsRail({
  questionId,
  slug,
  createdAt,
  versions,
  selected,
  panels,
  panel,
  actions,
}: {
  readonly questionId: string;
  /** The authored slug, for the details group. */
  readonly slug: string;
  /** When the question was first created, as an ISO instant. */
  readonly createdAt: string;
  /** Every version, oldest first, as the API returns them. */
  readonly versions: readonly QuestionVersion[];
  /** The version the address selects. Its row is the one marked current. */
  readonly selected: number;
  /** The selected version's editor panels, derived from its stored definition. */
  readonly panels: readonly QuestionPanel[];
  /** The panel the address opens, resolved by `panelFromParams`. */
  readonly panel: QuestionPanelId;
  /**
   * The lifecycle controls for the selected version, or nothing.
   *
   * A slot rather than an import, so this file stays a server component and the one place
   * that knows which server action a lifecycle button posts to stays the route that owns
   * that action.
   */
  readonly actions?: ReactNode;
}) {
  const items = versionRailItems(questionId, versions, selected);
  const published = latestPublishedVersion(versions);
  const digest =
    published === null
      ? tPlural("questions.rail.digestNoneOne", "questions.rail.digestNone", versions.length)
      : tPlural("questions.rail.digestOne", "questions.rail.digest", versions.length, {
          version: published,
        });
  const selectedVersion = versions.find((version) => version.version === selected);
  const type = selectedVersion?.definition.type;

  return (
    <div className="qcms-rail qcms-question-rail" data-testid="qcms-question-rail">
      {/* THE WAY BACK, AT THE TOP OF THE RAIL AND OUTSIDE THE DISCLOSURE (Code Owner,
          2026-09-27). It was the first line of the content column, above the `<h1>`, which is
          where a detail screen has always put it - but this screen's column is now a preview
          and one panel of a form, and a navigation link above them was the one thing in that
          column that went somewhere else. The rail is where this screen's navigation lives.

          Outside the `<details>` rather than inside its body, and that is the placement doing
          the work: below `--bp-sidebar` the rail collapses to its summary alone, so a back
          link in the body would be reachable only by expanding a rail first. Above it, it is
          the first thing on the screen at every width.

          An anchor, because it goes to another route (`docs/admin-constraints.md`). */}
      <Link href="/questions" className="qcms-question-rail__back">
        {t("questions.backToList")}
      </Link>
      {/* One native `<details>` at both widths, for the reasons `components/rail-frame.tsx`
          writes out at length: an element cannot be chosen by media query, a second copy of
          the navigation would be a second set of rows to walk, and the browser announces
          expanded and collapsed itself more reliably than any `aria-expanded` written by
          hand. Shut below `--bp-sidebar` and open above it, which is the shared collapse
          behaviour §7a names and the one part of the chrome that is NOT restated locally:
          `components/rail-disclosure.tsx` owns it. Above the boundary the chevron goes and
          the summary stops advertising itself as a control; it remains one. */}
      <RailDisclosure>
        <summary className="qcms-rail__summary">
          {/* The question's own id, and NOTHING ELSE (Code Owner, 2026-09-29). In the id style,
              because that is what this rail belongs to and what an author pastes into a ticket,
              and it is the one line that truncates.

              A collapsed-only "/ Version 2" stood beside it from issue 650 until 2026-09-29.
              Its reason was that below `--bp-sidebar`, shut, this line is the whole rail, so
              which version is showing was the one thing a reader could not otherwise get. That
              stopped being true when the screen's `<h1>` started naming the version
              (2026-09-28): the indicator then sat directly above a heading that said the same
              thing, which at 390 is two lines of the same fact. The form rail's summary shows
              just the form; this one shows just the question. */}
          <span className="qcms-rail__summary-text qcms-question-rail__summary-id">
            {questionId}
          </span>
          <span className="qcms-rail__chevron" aria-hidden="true">
            {"›"}
          </span>
        </summary>
        <div className="qcms-rail__body">
          {/* THE QUESTION'S DETAILS, UNDER ITS ID (Code Owner, 2026-09-27). These three were a
              meta strip under the `<h1>`: one paragraph of "Slug: x · Created: y · Type: z",
              which is a statement about the QUESTION sitting at the top of a column that now
              shows one panel of one version. They belong beside the id they describe, and the
              summary above is that id.

              A description list rather than a paragraph, because that is what three
              label-and-value pairs are, and because the rail carries no headings - the same
              `heading-order` constraint the group label below records.

              The TYPE IS STATED ONCE, HERE, WITH ITS LOCKED STATUS. It used to be said twice:
              in that strip, and again as "Type is locked to Long text." at the top of the
              version card. Two sentences for one immutable fact, one of which was inside the
              editor it constrains. R6 is what makes it permanent, so the rail states it where
              it states the question's other permanent facts and the editor states nothing.

              STILL UTC, and named rather than left to be discovered (issue #582). The Code
              Owner's 2026-09-11 ruling moved day columns onto the operator's own zone, and it
              was about TABLES: this is a detail route's rail, and a server component with no
              hydration swap to hang the operator zone on. The consequence is visible and
              accepted for now: the library table can name 3 Aug where this line names 2 Aug
              for an operator east of UTC, because they are the same instant read on two
              clocks. Extending the ruling here is a decision, not a detail. The version dates
              below carry the same note for the same reason. */}
          <dl className="qcms-question-rail__details">
            <dt>{t("questions.detail.slug")}</dt>
            <dd className="qcms-question-rail__details-slug">{slug}</dd>
            <dt>{t("questions.detail.created")}</dt>
            <dd>{formatDay(createdAt)}</dd>
            {type !== undefined && (
              <>
                <dt>{t("questions.detail.type")}</dt>
                <dd>{t("questions.detail.typeLocked", { type: t(`questions.type.${type}`) })}</dd>
              </>
            )}
          </dl>
          {actions}
          {/* Named after the question, because a screen reader listing landmarks on this
              screen otherwise sees "navigation" beside "navigation" and cannot tell the rail
              from the shell's own nav.

              THE PANEL ROWS ARE INSIDE THIS LANDMARK, which is worth a sentence because they
              are not navigation: they switch a panel on this page. They are here because they
              are the CHILDREN of the version row they sit under, and lifting them out would
              either put them outside the row that owns them or duplicate the row to carry
              them - the builder's rail nests its steps inside the Form row for the same
              reason. A `<nav>` that also contains the switches for the thing it navigated to
              is what the form builder's rail already is. */}
          {/* The digest, as one muted line above the list rather than as the uppercase header
              row with a right-aligned count this rail used to draw. `RailFrame` puts a rail's
              count in the summary as a tag, and that tag is the builder's amber ISSUE count -
              the wrong thing to borrow for a neutral "3 versions, v2 published". What the two
              rails genuinely share is the muted secondary treatment, so this takes that and
              nothing else. */}
          <p className="qcms-rail__sub qcms-question-rail__digest">{digest}</p>
          <nav aria-label={t("questions.rail.label", { questionId })}>
            {/* An unordered list, though versions are numbered: the ordinal is on every row
                already and is the version number itself, so an `<ol>` would have a screen
                reader read a position that disagrees with the label beside it as soon as the
                newest-first order puts version 4 in position 1. */}
            <ul
              className="qcms-rail__group"
              aria-label={t("questions.detail.versions")}
              data-rail-group="versions"
            >
              {items.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="qcms-rail__link qcms-rail__link--stacked"
                    data-rail-item={item.key}
                    data-rail-version={item.version}
                    {...(item.isCurrent ? { "aria-current": "page" as const } : {})}
                  >
                    <span className="qcms-rail__row">
                      <span>{t("questions.detail.version", { version: item.version })}</span>
                      <StatusTag status={item.status} />
                    </span>
                    {/* STILL UTC (issue #582): the 2026-09-11 ruling moved the day columns
                        of TABLES onto the operator's zone, and this is a rail. The same
                        note is on the details group above, which is the other surface that
                        can now disagree with a table about which day an instant fell on. */}
                    <span className="qcms-rail__sub">
                      {item.publishedAt === null
                        ? t("questions.detail.unpublished")
                        : t("questions.detail.publishedAt", { date: formatDay(item.publishedAt) })}
                    </span>
                  </Link>
                  {/* UNDER THE SELECTED VERSION AND ONLY IT (Code Owner, 2026-09-27). A panel
                      row opens a panel of the editor, and the editor is showing one version -
                      the selected one. Rows under every version would be rows that cannot do
                      what they say, and a frozen version's rows work exactly like a draft's:
                      they open the same panels, read-only, which is the same rule this screen
                      has applied to the editor itself since task 032. */}
                  {item.isCurrent && panels.length > 0 && (
                    <QuestionPanelRows panels={panels} selected={panel} />
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </RailDisclosure>
    </div>
  );
}
