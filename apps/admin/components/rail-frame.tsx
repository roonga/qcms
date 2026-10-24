import Link from "next/link";
import type { ReactNode } from "react";

import { RailDisclosure } from "@/components/rail-disclosure";
import { t } from "@/lib/i18n/en";

/**
 * THE rail. One frame, one anatomy, every screen that has one
 * (`plan/admin-design-contracts.md` §7.0, Code Owner 2026-10-24; issue #1116).
 *
 * ## This file used to say it was not "the rail". That is what changed
 *
 * It carried the shared quarter of three separately named rails - the column, the width,
 * the collapse and the anchors-not-buttons rule - and said at length that it must never
 * learn what a rail carries, because a flag here would be the seam along which three
 * different contracts got "unified". Three contracts is exactly what the 2026-10-24 ruling
 * retired: there is one rail now, it belongs to the page rather than to the app, and it
 * looks and behaves the same everywhere. So the frame knows the anatomy, and the three
 * callers hand it their parts instead of restating its chrome.
 *
 * ## The five parts, always in this order
 *
 * 1. **Header** - {@link back}, {@link title}, at most one {@link tag}, and {@link lines}
 *    for what a rail states about its subject under its name. Below `--bp-sidebar` the
 *    title line is the disclosure's summary and carries at most one {@link count}; the
 *    back link sits above it so it survives the collapse.
 * 2. **Sections** - {@link sections}, inside a `<nav>` named for the subject.
 * 3. **Children** - {@link children}, for a screen whose children are not nested inside
 *    the current section's own row. Both rails that have children today nest them there
 *    instead (the form's steps inside the Form row, a version's panels inside its version
 *    row), which is what "nested under the current section only" asks for, so this slot is
 *    the frame's declared place for the part rather than a prop with a caller.
 * 4. **Filters** - {@link filters}. Empty on every rail until #1117 and #1118 move the
 *    screens' filters in; declared here because the order is the contract, and a part
 *    added later in the wrong place is how an anatomy stops being one.
 * 5. **Actions** - {@link actions}: structural actions only. A lifecycle or destructive
 *    action belongs to the content heading row (§7.0 ruling 5).
 *
 * ## Why a native `<details>`, and where its open state is decided
 *
 * Below `--bp-sidebar` the contract asks for a disclosure; at and above it, for a 240px
 * column. An element cannot be chosen by media query, so the choice is between one
 * `<details>` at both widths and two copies of the same navigation in the DOM with one
 * hidden - and a second copy of a navigation is a second set of links for a screen reader
 * to walk, which is exactly what one shared frame exists to prevent.
 *
 * A native `<details>` also settles the accessibility of the collapsed state without a line
 * of script: the summary is keyboard-operable by construction and the browser announces
 * expanded and collapsed itself, which no `aria-expanded` we wrote by hand would do more
 * reliably. Above the boundary the chevron goes and the summary stops advertising itself as
 * a control (`app/globals.css`); it remains one, so an operator who wants the width back
 * can take it.
 *
 * **It is shut by default below the boundary and open above it** (Code Owner decision,
 * 2026-08-23), which is the one thing about the element that cannot be decided here:
 * `open` is an attribute and no media query sets one. `components/rail-disclosure.tsx` owns
 * that and writes out why it is a client component and what is true before it runs.
 *
 * **The Header is visible above the boundary on every rail**, which is a reversal: the form
 * rail used to hide its summary there, because its first row was the form's own screen and
 * carried the form's name a second time. §7.0 gives the Header a back link and a status tag
 * that no row carries, so the line is no longer a repetition and the form-only rule in
 * `app/globals.css` went with it.
 *
 * ## The back link is a sibling of the summary, not inside it
 *
 * §7.0 puts the back link in the Header, and below the boundary the Header is the summary.
 * It is rendered just above the `<details>` instead, for two reasons that point the same
 * way. `<summary>` is exposed as a button, so a link inside it is nested interactive
 * content and axe says so on every railed screen at once (`e2e/a11y-axe.pw.ts` runs three
 * modes per state). And the placement is already the ruled one: the question rail has put
 * its back link above the disclosure since 2026-09-27 precisely so that it survives the
 * collapse, which is what the 2026-10-24 clarification asks for too - the link stays
 * visible at 390, where the body is shut.
 *
 * A server component. Which row is current is a fact about the route, so it arrives as
 * markup from the caller rather than being read from the pathname in the browser.
 */
export function RailFrame({
  subject,
  back,
  title,
  tag,
  count,
  lines,
  sections,
  children,
  filters,
  actions,
  testId = "qcms-rail",
}: {
  /**
   * What this rail belongs to, as the landmark's accessible name: a form's display name,
   * a question's id, "Settings". The `<nav>` inside is named "<subject> sections" from the
   * same string, so the two cannot drift.
   */
  readonly subject: string;
  /** The parent screen, or nothing on a top-level screen (Settings has none). */
  readonly back?: { readonly href: string; readonly label: string };
  /** The subject's name, as the Header draws it. The one line that truncates. */
  readonly title: ReactNode;
  /** At most one status tag. */
  readonly tag?: ReactNode;
  /**
   * The one count the collapsed Header carries, already written out.
   *
   * The issue total on the form rail; the active filter count on a list screen, once #1117
   * gives those rails their filters. At most one, which is why this is a string rather
   * than a slot.
   */
  readonly count?: string;
  /** The Header's secondary lines: what this rail states about its subject. */
  readonly lines?: ReactNode;
  readonly sections?: ReactNode;
  readonly children?: ReactNode;
  readonly filters?: ReactNode;
  readonly actions?: ReactNode;
  /** The rail's test handle. One per screen family, so existing coverage keeps its hook. */
  readonly testId?: string;
}) {
  return (
    // AN `<aside>`, NAMED FOR ITS SUBJECT (§7.0). It was a `<nav>` on all three rails, which
    // made the whole column a navigation landmark - true of the version list inside it and
    // not of the panel switches, the filters or the actions beside them. The navigation is
    // the `<nav>` below; the column around it is complementary content about the subject.
    <aside className="qcms-rail" aria-label={subject} data-testid={testId}>
      {back !== undefined && (
        <Link href={back.href} className="qcms-rail__back">
          {/* Decorative: the link's own text says where it goes, and "single left-pointing
              angle quotation mark" read aloud in front of it says nothing. */}
          <span aria-hidden="true">{"‹"}</span>
          {back.label}
        </Link>
      )}
      <RailDisclosure>
        <summary className="qcms-rail__summary">
          <span className="qcms-rail__summary-text">{title}</span>
          {tag}
          {count !== undefined && (
            <span className="qcms-tag qcms-tag--draft" data-testid="qcms-rail-summary-count">
              {count}
            </span>
          )}
          {/* Decorative: the disclosure's state is already announced by the element
              itself, so a second statement of it here would only be said twice. */}
          <span className="qcms-rail__chevron" aria-hidden="true">
            {"›"}
          </span>
        </summary>
        <div className="qcms-rail__body">
          {lines}
          {sections !== undefined && (
            // Named for the subject, because a screen reader listing landmarks otherwise
            // meets "navigation" beside "navigation" and cannot tell the rail's own
            // navigation from the shell's.
            <nav aria-label={t("rail.sections", { subject })}>{sections}</nav>
          )}
          {children}
          {filters}
          {actions !== undefined && <div className="qcms-rail__actions">{actions}</div>}
        </div>
      </RailDisclosure>
    </aside>
  );
}
