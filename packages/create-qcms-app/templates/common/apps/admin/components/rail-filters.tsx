import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/kit";
import { t, tPlural } from "@/lib/i18n/en";

/**
 * The rail's Filters part (`plan/admin-design-contracts.md` §7.0 ruling 2.4 and ruling 4,
 * Code Owner 2026-10-24; issue #1117).
 *
 * ## One part, not one toolbar per list screen
 *
 * Four screens filtered and each one drew its own card above its own table: a `<form
 * method="get">` wrapping a flat fieldset, a visually hidden legend worded per screen, an
 * Apply button and a clear link, repeated. §7.0 ruling 4 moves the filters out of the
 * content column and into the rail, and the only way that does not become four rails is for
 * the part to be one component: the screens hand it their controls, and the title, the
 * active count, Apply and the clear link are the frame's.
 *
 * So what a screen still owns is exactly what is screen-specific - which controls, in the
 * ruled order (Search, status, type or other, then sort) - and what it no longer owns is the
 * chrome it used to restate.
 *
 * ## It is still a native GET form, and that is the point of it
 *
 * The URL carries the state (§7.0 ruling 2.4), so a filtered list is a link an author can
 * send, a page that survives a reload, and a state the back button undoes. Apply is a
 * submission the browser performs rather than a handler this app writes, which is what keeps
 * those three properties true without a line of script.
 *
 * **That is not a no-JS path and is not claimed as one.** The admin requires JavaScript
 * (Code Owner, 2026-09-27, and the correction recorded on issue #1117), so a native
 * submission here is chosen because it is the simplest correct mechanism for putting state in
 * an address, not because anything has to work without hydration.
 *
 * ## Why the active count sits here and in the Header
 *
 * Twice, deliberately, and they are two different readers. Above `--bp-sidebar` the part is
 * open and its own count is beside its title, where somebody looking at the controls reads
 * it. Below the boundary the rail is a shut disclosure, so the only line on screen is the
 * Header - and the 2026-10-24 clarification gives that line the active filter count on a list
 * screen, which is what tells a reader there is a filter in force before they open anything.
 * One number, computed once by the screen and rendered in both places, rather than two counts
 * that could disagree.
 *
 * ## Why "Filters" is a paragraph rather than an `<h2>`
 *
 * The rail renders before `<main>` on every screen, so a heading element in it would sit
 * above that screen's `<h1>` in document order and `heading-order` would report it on every
 * railed screen at once (`e2e/a11y-axe.pw.ts` runs axe over three modes per state). The
 * contract asks for a "Filters" heading, meaning the visible title the POCs draw, and that is
 * what this is: a visible title, plus the same word as the search region's accessible name so
 * nothing is lost to a screen reader.
 */
export function RailFilters({
  activeCount,
  clearHref,
  children,
}: {
  /**
   * How many of this screen's filters are set, which the screen counts because it is the
   * only tree that parsed them. Zero hides the count and the clear link.
   */
  readonly activeCount: number;
  /** The screen's own unfiltered address, which the clear link goes to. */
  readonly clearHref: string;
  /** The screen's controls, in the ruled order. */
  readonly children: ReactNode;
}) {
  return (
    // `role="search"` by the ruling, and `qcms-filters` kept from the toolbar this replaces:
    // the class is the column rhythm these controls were already laid out with, and it is
    // what the browser suite locates the form by, so a move between columns does not have to
    // be a rename as well.
    <form
      method="get"
      role="search"
      aria-label={t("rail.filters")}
      className="qcms-filters qcms-rail__filters"
      data-testid="qcms-rail-filters"
    >
      <p className="qcms-rail__filters-title" data-testid="qcms-rail-filters-title">
        <span>{t("rail.filters")}</span>
        {activeCount > 0 && (
          <span className="qcms-tag qcms-tag--draft" data-rail-filters-active={activeCount}>
            {activeFilterCount(activeCount)}
          </span>
        )}
      </p>
      {children}
      <div className="qcms-rail__filters-apply">
        <Button type="submit" variant="secondary" size="md">
          {t("rail.filters.apply")}
        </Button>
        {/* SHOWN ONLY WHEN A FILTER IS SET (the issue's own wording). It is the single
            "Clear filters" control on the screen now: the filtered-empty panels used to
            carry one as their call to action, and two controls with the same accessible
            name on one screen are ambiguous to anyone navigating by name - the browser
            suite said so once already, resolving that name to two elements
            (`e2e/questions-lifecycle.pw.ts`). The way out of a filter belongs where the
            filter is. */}
        {activeCount > 0 && (
          <Link href={clearHref} className="qcms-text-link">
            {t("rail.filters.clear")}
          </Link>
        )}
      </div>
    </form>
  );
}

/**
 * The active-filter count, written out once for the two places that show it.
 *
 * The Filters part renders it beside its own title and the Header renders it in the collapsed
 * summary, and a rail where those two said different things would be a rail disagreeing with
 * itself. Exported so a screen can pass the same string into {@link RailFrame}'s `count`.
 */
export function activeFilterCount(count: number): string {
  return tPlural("rail.filters.activeOne", "rail.filters.active", count);
}
