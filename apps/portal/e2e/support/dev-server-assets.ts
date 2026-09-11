/**
 * Assets the Next DEV server serves from the portal's own origin (issue #193).
 *
 * The browser suite boots the portal with `next dev` (`portal-server.mjs`), and a dev
 * server is not only a server for your app: it serves its own chrome from the same
 * origin. The one that has already cost a red run is the error overlay's typeface,
 * `/__nextjs_font/geist-latin.woff2`. Being same-origin, it does not break the
 * zero-external-request claim `fonts.pw.ts` makes - it makes a wholesale count of
 * `woff2` requests wrong by exactly one, and reads as "a font we did not expect was
 * downloaded".
 *
 * **So never count page assets wholesale under `next dev`.** Derive the expected set
 * from its source of truth (the font manifest, the build manifest, the fixture) and
 * match POSITIVELY. An exclusion list is the tempting fix and the worse one: it grows
 * silently until the assertion stops meaning anything, whereas an inclusion filter
 * derived from the manifest cannot drift.
 *
 * This module is the second half of that discipline rather than a replacement for it.
 * A positive filter answers "did everything we declared arrive"; it says nothing about
 * what ELSE arrived, so an unexpected asset passes unnoticed. Partitioning the requests
 * into ours / the dev server's / neither lets a spec assert that the third set is empty,
 * which is a stronger claim than the count it replaces - and it identifies the dev
 * server's own assets by a stable path predicate, never by subtracting one.
 *
 * The predicate is Next's own convention: internal dev endpoints live under a
 * `/__nextjs` path prefix (the overlay font, the stack-frame and launch-editor
 * endpoints, the segment explorer) and HMR rides `/_next/webpack-hmr`. Matching the
 * prefix rather than the single known filename means the next piece of dev chrome
 * arrives as a recognised dev asset instead of a red run.
 */

/**
 * Path prefixes that belong to the dev server rather than to the portal. Matched
 * against the URL's pathname, so a query string or a port cannot defeat them.
 */
export const DEV_SERVER_PATH_PREFIXES: readonly string[] = ["/__nextjs", "/_next/webpack-hmr"];

/**
 * Is this URL dev-server chrome rather than portal content?
 *
 * A URL that cannot be parsed is not dev chrome: callers are asserting about requests
 * the browser actually made, and something unparseable belongs in the "unexpected" pile
 * where a human will look at it.
 */
export function isDevServerAsset(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  return DEV_SERVER_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Split observed request URLs into the ones a spec declared, the dev server's own, and
 * everything else.
 *
 * `isOurs` is the positive, manifest-derived filter. It is applied first and then
 * re-checked against the dev-server predicate, so a spec cannot satisfy "our file
 * arrived" with a dev-server asset that happens to share a name - the overlay ships
 * `geist-latin.woff2`, and the font registry is one entry away from a stem that would
 * collide with it.
 */
export function partitionRequests(
  urls: readonly string[],
  isOurs: (url: string) => boolean,
): { ours: string[]; devServer: string[]; unexpected: string[] } {
  const ours: string[] = [];
  const devServer: string[] = [];
  const unexpected: string[] = [];
  for (const url of urls) {
    if (isDevServerAsset(url)) devServer.push(url);
    else if (isOurs(url)) ours.push(url);
    else unexpected.push(url);
  }
  return { ours, devServer, unexpected };
}
