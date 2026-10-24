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
 * matches has to render nothing. That is this function, and nine pages exported it - each one
 * line saying "this route has a rail, and it has no section of its own".
 *
 * ## It has no caller today, and that is why it is still here
 *
 * §7.0 of `plan/admin-design-contracts.md` (Code Owner, 2026-10-24) gives every screen a
 * rail by default, and issue #1117 built the nine that had none. A screen goes without one
 * only by a per-screen ruling recorded in §7.0's own table, and none is ruled - so the
 * function stands ready for an exception that does not exist rather than being deleted and
 * reinvented by whoever is granted the first one.
 *
 * What it must NOT become is the convenient answer for a screen nobody wanted to design a
 * rail for. `lib/rail-routes.test.ts` is the gate: it compares the two route trees off the
 * filesystem, so a screen added without a slot page fails there, and it lists the routes
 * that export this - empty - so a screen that quietly started exporting it fails there too.
 */
export function NoRailSection(): null {
  return null;
}
