import { describe, expect, it } from "vitest";

import { sessionCookieOptions } from "./cookie-options";

/**
 * Exit criterion 4: the session cookie is httpOnly + SameSite, and secure in
 * production. The session bearer never reaches client JS (httpOnly) and is not
 * usable cross-site (SameSite).
 */
describe("session cookie options", () => {
  it("is always httpOnly and SameSite=lax on the root path", () => {
    const opts = sessionCookieOptions(false);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
  });

  it("is secure in production and not secure in local http dev", () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
    expect(sessionCookieOptions(false).secure).toBe(false);
  });
});
