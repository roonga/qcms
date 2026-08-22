import Link from "next/link";
import type { ReactNode } from "react";

import { StatusTag } from "@/components/questions/status-tag";
import { t, tPlural } from "@/lib/i18n/en";
import type { QuestionVersion } from "@/lib/questions/types";
import { isoDay, latestPublishedVersion, versionRailItems } from "@/lib/questions/version-rail";

/**
 * The question detail screen's rail, built to `plan/admin-shell-poc/question-editor-poc.html`
 * (issue 650).
 *
 * ## A third rail, named distinctly, and not a variant of either of the other two
 *
 * The app now ships three rails that share a column and share nothing else.
 * `components/forms/form-subtree-rail.tsx` navigates between the ROUTES of one form's
 * subtree. `components/settings-section-rail.tsx` switches which PANEL of the single
 * Settings route is on screen. This one lists one question's versions, each of which is a
 * `?v=` on the route the reader is already standing on. Three different answers to "what
 * does a rail carry", which is why they are three files rather than one component with a
 * flag: a flag would be the seam along which the three contracts get unified, and the next
 * change to any of them would have to be argued as a change to all three.
 *
 * **`components/rail-frame.tsx` is not widened for this.** No base component, no widened
 * props type, no variant flag, no shared module. One thing stayed local rather than being
 * pushed into the shared file and it is named here so a reader does not have to diff to find
 * it: the `<details>` chrome below is restated rather than taken from `RailFrame`, because
 * the POC's summary carries a collapsed-only "which version" indicator and `RailFrame`'s
 * summary takes a text line and an issue-count tag and nothing else. That is the same trade
 * the Settings rail made for the same reason.
 *
 * ## What it carries: this question's versions, and the actions on the selected one
 *
 * The POC draws one group - the version list - with the lifecycle actions pinned above it,
 * and states its own reason for both: a question's only children are its versions and it has
 * no sibling screens, so where a form's rail has two groups and a divider this one has a
 * single group; and the version list is the one thing on this screen that grows without
 * bound, so an action anchored below it would drift further down the rail with every version
 * the question accumulates.
 *
 * **A rail here carries actions, and that is this screen's drawing rather than a new general
 * rule.** The form-subtree rail carries none and still carries none: it says so in its own
 * file, and nothing about this component reaches it.
 *
 * ## Server-rendered, anchors for the rows, buttons for the actions
 *
 * Which version is selected is a fact about the address, so it arrives as a prop rather than
 * being read from the browser. Every row is an anchor because a row goes to another address
 * and open-in-new-tab has to work; the lifecycle controls are buttons because they act on the
 * version already on screen (`docs/admin-constraints.md`: an anchor navigates, a button acts).
 * The rail itself ships no JavaScript - the actions are a client subtree handed in whole, so
 * this component stays a server component and the version list is operable before hydration.
 */
export function QuestionVersionsRail({
  questionId,
  versions,
  selected,
  actions,
}: {
  readonly questionId: string;
  /** Every version, oldest first, as the API returns them. */
  readonly versions: readonly QuestionVersion[];
  /** The version the address selects. Its row is the one marked current. */
  readonly selected: number;
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

  return (
    <div className="qcms-rail qcms-question-rail" data-testid="qcms-question-rail">
      {/* A native `<details open>` at every width, for the reasons `components/rail-frame.tsx`
          writes out at length: an element cannot be chosen by media query, a second copy of
          the navigation would be a second set of rows to walk, and the browser announces
          expanded and collapsed itself more reliably than any `aria-expanded` written by
          hand. Above `--bp-sidebar` the chevron goes and the summary stops advertising
          itself as a control; it remains one. */}
      <details className="qcms-rail__disclosure" open>
        <summary className="qcms-rail__summary">
          {/* The question's own id, in the id style, because that is what this rail belongs
              to and what an author pastes into a ticket. It is the one line that truncates. */}
          <span className="qcms-rail__summary-text qcms-question-rail__summary-id">
            {questionId}
          </span>
          {/* Collapsed-only, and only below `--bp-sidebar`: above it the rail is a permanent
              sidebar and the marked row is right there, so this would repeat it. Below it,
              closed, this line is the whole rail, and which version is showing is the one
              thing a reader needs from it. `app/globals.css` owns both conditions. */}
          <span className="qcms-question-rail__summary-version">
            <span className="qcms-question-rail__summary-sep" aria-hidden="true">
              {"/"}
            </span>
            {t("questions.detail.version", { version: selected })}
          </span>
          <span className="qcms-rail__chevron" aria-hidden="true">
            {"›"}
          </span>
        </summary>
        <div className="qcms-rail__body">
          {/* A labelled row rather than a heading, and that is a choice about heading order
              rather than an oversight: the rail renders before `<main>` in document order, so
              a heading here would sit above the screen's `<h1>` and be a `heading-order`
              violation on this screen in all three modes (`e2e/a11y-axe.pw.ts` says so). The
              POC draws this row rather than a heading for its own version of that reason. */}
          <div className="qcms-question-rail__label">
            <span className="qcms-question-rail__title">{t("questions.detail.versions")}</span>
            <span className="qcms-question-rail__digest">{digest}</span>
          </div>
          {actions}
          {/* Named after the question, because a screen reader listing landmarks on this
              screen otherwise sees "navigation" beside "navigation" and cannot tell the rail
              from the shell's own nav. */}
          <nav aria-label={t("questions.rail.label", { questionId })}>
            {/* An unordered list, though versions are numbered: the ordinal is on every row
                already and is the version number itself, so an `<ol>` would have a screen
                reader read a position that disagrees with the label beside it as soon as the
                newest-first order puts version 4 in position 1. */}
            <ul className="qcms-rail__group">
              {items.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="qcms-rail__link qcms-question-rail__version"
                    data-rail-version={item.version}
                    {...(item.isCurrent ? { "aria-current": "page" as const } : {})}
                  >
                    <span className="qcms-question-rail__version-row">
                      <span>{t("questions.detail.version", { version: item.version })}</span>
                      <StatusTag status={item.status} />
                    </span>
                    <span className="qcms-question-rail__version-date">
                      {item.publishedAt === null
                        ? t("questions.detail.unpublished")
                        : t("questions.detail.publishedAt", { date: isoDay(item.publishedAt) })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </details>
    </div>
  );
}
