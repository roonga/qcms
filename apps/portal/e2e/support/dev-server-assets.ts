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
