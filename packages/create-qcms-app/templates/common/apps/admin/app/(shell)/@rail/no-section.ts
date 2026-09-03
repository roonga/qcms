/**
 * The rail section for a route that contributes none.
 *
 * ## Why these routes have a page in the slot at all, rather than relying on `default.tsx`
 *
 * On a SOFT navigation Next keeps the previously active state of any slot the new URL does
 * not match, and consults `default.tsx` only after a full-page load. The file convention's
 * own reference says so, and this app shipped the opposite belief written into a comment:
 * walking from Settings to the question library left the Settings section standing in the
 * rail beside a screen it says nothing about, because `/questions` matched nothing under
 * `@rail` and Next therefore changed nothing there.
 *
 * A route that matches nothing cannot be given a fallback. It has to MATCH, and what it
 * matches has to render nothing. That is this function, and the ten pages that export it are
 * each one line saying "this route has a rail, and it has no section of its own".
 *
 * `lib/rail-routes.test.ts` compares the two route trees off the filesystem, so a screen
 * added without a slot page fails there rather than being discovered as a stale rail months
 * later.
 */
export function NoRailSection(): null {
  return null;
}
