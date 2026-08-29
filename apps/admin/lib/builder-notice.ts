/**
 * Whether the operator has already read the builder's concurrent-edit warning.
 *
 * ## Why a cookie and not `localStorage`
 *
 * The same reason `lib/appearance.ts` gives, and here it has a second half. `localStorage`
 * is unreachable during SSR, so a notice gated on it can only be *corrected* after
 * hydration: either it flashes up and vanishes for someone who dismissed it, or it appears
 * a moment late and pushes the screen down as it arrives. The second is a layout shift, and
 * this app has just finished removing one. A cookie is on the request, so the server knows
 * before it renders and the screen is right in its first byte.
 *
 * ## What it is and is not
 *
 * A preference, not a decision the product depends on. Nothing is unsafe if it is missing,
 * forged or cleared: the worst case is that an operator reads a warning again. So it is
 * unsigned, it is not `HttpOnly` - the dismiss control writes it from the browser, with no
 * round trip for something this small - and any value other than the one below means "not
 * dismissed", which is the direction that fails towards showing the warning.
 */
export const CONCURRENT_NOTICE_COOKIE = "qcms-builder-concurrent-read";

/** The one value that counts as dismissed. Anything else shows the notice. */
const DISMISSED = "1";

/** A year, like the appearance cookie: a preference outlives a session by design. */
export const CONCURRENT_NOTICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Whether the notice has been dismissed, from the raw cookie value the server read. */
export function isConcurrentNoticeDismissed(raw: string | undefined): boolean {
  return raw === DISMISSED;
}

/** The `document.cookie` assignment the dismiss control writes. */
export function concurrentNoticeCookie(secure: boolean): string {
  const attributes = [
    `${CONCURRENT_NOTICE_COOKIE}=${DISMISSED}`,
    "Path=/",
    `Max-Age=${CONCURRENT_NOTICE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
