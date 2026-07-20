/**
 * Challenge seam unit tests (task 026). The end-to-end enforcement (a
 * challengeRequired form rejecting/admitting via start-session) is covered in
 * `start-session.integration.test.ts`; here we pin the verifier implementations
 * and the provider selector.
 */

import { describe, expect, it, vi } from "vitest";

import type { Config } from "../../config.js";
import { createNullLogger } from "../../logger.js";
import {
  nullChallengeVerifier,
  selectChallengeVerifier,
  turnstileChallengeVerifier,
} from "./challenge.js";

function configWith(provider: "none" | "turnstile"): Config {
  return { flags: { challengeProvider: provider } } as unknown as Config;
}

describe("nullChallengeVerifier (provider none)", () => {
  it("accepts everything, including a missing token — the no-op path", async () => {
    expect(await nullChallengeVerifier.verify(undefined, undefined)).toEqual({ ok: true });
    expect(await nullChallengeVerifier.verify("anything", "1.2.3.4")).toEqual({ ok: true });
  });
});

describe("turnstileChallengeVerifier (029 shell)", () => {
  it("fails closed and warns until 029 implements it", async () => {
    const logger = createNullLogger();
    const warn = vi.spyOn(logger, "warn");
    const verifier = turnstileChallengeVerifier(logger);
    expect(await verifier.verify("solution", "1.2.3.4")).toEqual({ ok: false });
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("selectChallengeVerifier", () => {
  it("returns the null verifier for provider none", () => {
    expect(selectChallengeVerifier(configWith("none"), createNullLogger())).toBe(
      nullChallengeVerifier,
    );
  });

  it("returns a fail-closed verifier for provider turnstile", async () => {
    const verifier = selectChallengeVerifier(configWith("turnstile"), createNullLogger());
    expect(await verifier.verify("solution", "1.2.3.4")).toEqual({ ok: false });
  });
});
