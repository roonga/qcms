import { describe, expect, it } from "vitest";

import {
  CONCURRENT_NOTICE_COOKIE,
  concurrentNoticeCookie,
  isConcurrentNoticeDismissed,
} from "./builder-notice.ts";

/**
 * The direction this preference fails in, which is the only thing about it worth pinning.
 *
 * Every value other than the one the dismiss control writes means "show the warning". That
 * is deliberate and it is the whole safety argument for an unsigned, browser-written
 * cookie: a forged, truncated or half-cleared value cannot suppress a warning about silent
 * data loss, it can only fail to suppress it.
 */
describe("the concurrent-notice preference", () => {
  it("counts only the value the dismiss control writes", () => {
    expect(isConcurrentNoticeDismissed("1")).toBe(true);
  });

  it("shows the warning for every other value, including none", () => {
    for (const raw of [undefined, "", "0", "true", "yes", " 1", "1 ", "01"]) {
      expect(isConcurrentNoticeDismissed(raw), `${JSON.stringify(raw)} must not dismiss`).toBe(
        false,
      );
    }
  });

  it("writes a year-long path-wide cookie, and marks it Secure only over https", () => {
    // `Path=/` because the preference is the operator's rather than this form's: dismissing
    // it on one form's builder dismisses it on every form's, which is what a standing fact
    // about how the app saves deserves.
    expect(concurrentNoticeCookie(false)).toBe(
      `${CONCURRENT_NOTICE_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
    expect(concurrentNoticeCookie(true)).toBe(
      `${CONCURRENT_NOTICE_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
  });
});
