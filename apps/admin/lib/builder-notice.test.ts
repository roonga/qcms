import { describe, expect, it } from "vitest";

import {
  CONCURRENT_NOTICE_COOKIE,
  concurrentNoticeCookie,
  isConcurrentNoticeDismissed,
} from "./builder-notice.ts";

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
    expect(concurrentNoticeCookie(false)).toBe(
      `${CONCURRENT_NOTICE_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
    expect(concurrentNoticeCookie(true)).toBe(
      `${CONCURRENT_NOTICE_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
  });
});
