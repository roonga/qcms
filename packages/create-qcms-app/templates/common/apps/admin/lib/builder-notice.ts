/** A cookie lets SSR avoid notice flashes and layout shifts. This unsigned preference fails toward showing the warning: every value except the dismissal marker leaves it visible. */
export const CONCURRENT_NOTICE_COOKIE = "qcms-builder-concurrent-read";

const DISMISSED = "1";

export const CONCURRENT_NOTICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isConcurrentNoticeDismissed(raw: string | undefined): boolean {
  return raw === DISMISSED;
}

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
