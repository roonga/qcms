import { afterEach, describe, expect, it } from "vitest";

import { challengeProvider } from "./challenge";

/**
 * ADR-24 / SEC-9: the challenge provider is resolved solely from the typed env
 * flag (no client-side flag evaluation). Default is `none`.
 */
describe("challenge provider flag", () => {
  const original = process.env.QCMS_FLAG_CHALLENGE_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.QCMS_FLAG_CHALLENGE_PROVIDER;
    else process.env.QCMS_FLAG_CHALLENGE_PROVIDER = original;
  });

  it("defaults to none when the flag is unset", () => {
    delete process.env.QCMS_FLAG_CHALLENGE_PROVIDER;
    expect(challengeProvider()).toBe("none");
  });

  it("is none for any value other than turnstile", () => {
    process.env.QCMS_FLAG_CHALLENGE_PROVIDER = "recaptcha";
    expect(challengeProvider()).toBe("none");
  });

  it("is turnstile only for the exact flag value", () => {
    process.env.QCMS_FLAG_CHALLENGE_PROVIDER = "turnstile";
    expect(challengeProvider()).toBe("turnstile");
  });
});
