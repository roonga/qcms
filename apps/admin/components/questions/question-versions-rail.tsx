import Link from "next/link";
import type { ReactNode } from "react";

import { OperatorDay } from "@/components/operator-time";
import { PublishedOnDay } from "@/components/questions/published-on-day";
import { QuestionPanelRows } from "@/components/questions/question-panel-rows";
import { StatusTag } from "@/components/questions/status-tag";
import { RailFrame } from "@/components/rail-frame";
import { t, tPlural } from "@/lib/i18n/en";
import type { QuestionPanel, QuestionPanelId } from "@/lib/questions/panels";
import type { QuestionVersion } from "@/lib/questions/types";
import { latestPublishedVersion, versionRailItems } from "@/lib/questions/version-rail";

/**
 * The question detail screen's parts of the one rail (`plan/admin-design-contracts.md`
 * §7.0, issues 650 and #1116).
 *
 * ## It was a third rail. There is one rail now
 *
 * This file used to restate the frame's chrome - the disclosure, the summary, the body - and
 * argued at length that it should, because three rails answered "what does a rail carry"
 * three ways and a shared frame would be the seam along which those three contracts got
 * unified. The 2026-10-24 ruling unified them deliberately: one frame, one anatomy, one
 * current-row mark, on every screen. So the restated chrome is gone and this file is the
 * five parts, as `components/rail-frame.tsx` takes them.
 *
 * - **Header:** back to Questions, the question's id, the selected version's status, and
 *   under them the question's own permanent facts - slug, created day, and the type with
 *   its locked status - plus the version digest. The details group staying in the Header is
 *   the 2026-10-24 clarification to §7.0; it is a statement about the SUBJECT, which is what
 *   the Header is for.
 * - **Sections:** the version list. Each row is `?v=` on the route the reader is already
 *   standing on.
 *
 *   **No count in the Header**, which the form rail does carry. The 2026-10-24 clarification
 *   allows the collapsed Header one, and on this screen the number it could hold - how many
 *   panels of the selected version carry an issue - exists only in the browser: the badges
 *   come from the editor's live document through `lib/questions/editor-bridge.ts`, and this is
 *   a server component so that the marked row and the rendered panel agree before anything
 *   has hydrated. A total here would mean a client component in the Header for a number that
 *   is zero until a save is refused. Left absent rather than faked.
 * - **Children:** the selected version's editor panels, nested inside its version row,
 *   which is what "nested under the current section only" asks for and what the builder's
 *   rail already does with a form's steps.
 * - **Actions:** New version, and only that. **Publish and Deprecate left the rail**
 *   (§7.0 ruling 5: the rail never holds a lifecycle action), and they are in the screen's
 *   heading row beside Save - `app/(shell)/questions/[questionId]/page.tsx`.
 *
 * ## One current mark, and the parent of the current row
 *
 * A version row and the panel row nested under it are both true statements about the
 * address, so both still carry `aria-current="page"`. What changed is the paint: §7.0 gives
 * the parent of the current row weight 600 and no fill, so a reader sees one selected row
 * rather than two stacked ones. One rule in `app/globals.css` does that for every rail.
 *
 * ## Anchors, never buttons
 *
 * Which version is selected and which panel is open are both facts about the address, so
 * both arrive as props rather than being read from the browser. Both kinds of row are
 * anchors (§7.0 ruling 2.2): a version row goes to another address, and a panel row is a
 * fragment anchor onto the panel it opens - `components/questions/question-panel-rows.tsx`
 * records what that buys and what it does not pretend to.
 *
 * This component stays a **server** component: the panel rows are a client child and the
 * one action arrives as a slot, so the version list, the details and the back link are
 * resolved once, on the server, from the address. That buys a correct FIRST PAINT rather
 * than reach - the admin requires JavaScript (Code Owner, 2026-09-27) - and it is what lets
 * the marked row and the rendered panel agree before anything has hydrated.
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
   * The Actions part: New version, or nothing.
   *
   * A slot rather than an import, so this file stays a server component and the one place
   * that knows which server action the control posts to stays the route that owns that
   * action. It is one structural action now: the lifecycle pair moved to the screen's
   * heading row (§7.0 ruling 5).
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
    <RailFrame
      subject={questionId}
      back={{ href: "/questions", label: t("questions.title") }}
      /* The question's own id, in the id style, because that is what this rail belongs to
         and what an author pastes into a ticket. The truncation is the frame's: the Header's
         name is the one line in a rail that ellipses. */
      title={<span className="qcms-rail__id">{questionId}</span>}
      testId="qcms-question-rail"
      {...(selectedVersion === undefined
        ? {}
        : { tag: <StatusTag status={selectedVersion.status} /> })}
      {...(actions === undefined ? {} : { actions })}
      lines={
        <>
          {/* THE QUESTION'S DETAILS, UNDER ITS ID (Code Owner, 2026-09-27; kept in the
              Header by the 2026-10-24 clarification to §7.0). These three were a meta strip
              under the `<h1>`: one paragraph of "Slug: x · Created: y · Type: z", which is a
              statement about the QUESTION sitting at the top of a column that now shows one
              panel of one version. They belong beside the id they describe, and the Header
              above is that id.

              A description list rather than a paragraph, because that is what three
              label-and-value pairs are, and because the rail carries no headings - the same
              `heading-order` constraint the group labels below record.

              The TYPE IS STATED ONCE, HERE, WITH ITS LOCKED STATUS. It used to be said
              twice: in that strip, and again as "Type is locked to Long text." at the top of
              the version card. Two sentences for one immutable fact, one of which was inside
              the editor it constrains. R6 is what makes it permanent, so the rail states it
              where it states the question's other permanent facts and the editor states
              nothing.

              ON THE OPERATOR'S CLOCK, like every admin time (Code Owner, 2026-10-19). This
              line used to stay UTC, so the library table could name 3 Aug where this line
              named 2 Aug for an operator east of UTC. The ruling made operator-local display
              apply everywhere, so the day comes from the same client component the table
              uses. */}
          <dl className="qcms-rail__facts">
            <dt>{t("questions.detail.slug")}</dt>
            <dd className="qcms-rail__facts-slug">{slug}</dd>
            <dt>{t("questions.detail.created")}</dt>
            <dd>
              <OperatorDay iso={createdAt} />
            </dd>
            {type !== undefined && (
              <>
                <dt>{t("questions.detail.type")}</dt>
                <dd>{t("questions.detail.typeLocked", { type: t(`questions.type.${type}`) })}</dd>
              </>
            )}
          </dl>
          {/* The digest, as one muted line above the list rather than as an uppercase header
              row with a right-aligned count. It is a neutral "3 versions, v2 published",
              where the Header's one count slot carries an amber ISSUE total - the wrong
              device to borrow for this. What it shares with a row's second line is the muted
              secondary treatment, so it takes that and nothing else. */}
          <p className="qcms-rail__sub qcms-rail__digest">{digest}</p>
        </>
      }
      sections={
        /* An unordered list, though versions are numbered: the ordinal is on every row
           already and is the version number itself, so an `<ol>` would have a screen reader
           read a position that disagrees with the label beside it as soon as the
           newest-first order puts version 4 in position 1. */
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
                {/* The operator's day, as on the details group above (2026-10-19). */}
                <span className="qcms-rail__sub">
                  {item.publishedAt === null ? (
                    t("questions.detail.unpublished")
                  ) : (
                    <PublishedOnDay iso={item.publishedAt} />
                  )}
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
      }
    />
  );
}
