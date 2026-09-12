import { describe, expect, it } from "vitest";

import {
  PASSWORD_COMPROMISED_CODE,
  passwordRefusalFrom,
  passwordRefusalOf,
} from "./password-refusal.ts";

/**
 * The one change-password refusal allowed to be specific (issue #437).
 *
 * Two properties, and the second is the one that matters for SEC-1. The ruled code must
 * reach the actionable sentence, because an admin who cannot tell a breached password
 * from a mistyped current one retries the breached one; and EVERYTHING ELSE must fall
 * back to the generic message, because a second specific branch arriving by accident is
 * exactly how a form becomes a password-checking oracle. So the negative cases are the
 * bulk of this file on purpose: the mapping fails closed on a body it cannot read, on a
 * code it does not know, and on anything that merely resembles the ruled one.
 */

/** The body better-auth's mount forwards for a corpus hit: `{ code, message }`, top level. */
const CORPUS_HIT = {
  code: PASSWORD_COMPROMISED_CODE,
  message: "The password you entered has been compromised.",
};

/** A refusal, as the route only ever calls this on a non-2xx. */
function refusal(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("passwordRefusalOf", () => {
  it("names the corpus hit, which is the whole exception", () => {
    expect(passwordRefusalOf(CORPUS_HIT)).toBe("compromised");
  });

  it("keeps the generic sentence for a wrong current password", () => {
    // The refusal SEC-1 is written about. It must be indistinguishable from a rejected
    // new password, which is what makes this assertion the anti-oracle property itself.
    expect(passwordRefusalOf({ code: "INVALID_PASSWORD", message: "Invalid password" })).toBe(
      "generic",
    );
  });

  it("keeps the generic sentence for the other refusals this form can produce", () => {
    for (const code of [
      "PASSWORD_TOO_SHORT",
      "PASSWORD_TOO_LONG",
      "CREDENTIAL_ACCOUNT_NOT_FOUND",
      "BREACH_CORPUS_UNREACHABLE",
    ]) {
      expect(passwordRefusalOf({ code })).toBe("generic");
    }
  });

  it("does not match a code that merely contains or resembles the ruled one", () => {
    expect(passwordRefusalOf({ code: "NOT_PASSWORD_COMPROMISED" })).toBe("generic");
    expect(passwordRefusalOf({ code: "PASSWORD_COMPROMISED_MAYBE" })).toBe("generic");
    expect(passwordRefusalOf({ code: "password_compromised" })).toBe("generic");
  });

  it("falls back to generic for every shape that is not an object with that code", () => {
    for (const body of [undefined, null, "PASSWORD_COMPROMISED", 400, [], {}, { code: 7 }]) {
      expect(passwordRefusalOf(body)).toBe("generic");
    }
  });

  it("ignores the vendor's prose, which is the reason it reads a code at all", () => {
    // The message is wording the vendor may change; the code is its `$ERROR_CODES` entry.
    expect(passwordRefusalOf({ message: "The password you entered has been compromised." })).toBe(
      "generic",
    );
  });
});

describe("passwordRefusalFrom", () => {
  it("reads the code off the refusal the mount forwards", async () => {
    await expect(passwordRefusalFrom(refusal(CORPUS_HIT))).resolves.toBe("compromised");
  });

  it("is generic for a refusal whose body is not JSON at all", async () => {
    // A proxy's HTML error page, or an empty body. Neither can be parsed, and the message
    // that distinguishes nothing is always a true thing to say.
    const html = new Response("<html>502</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    await expect(passwordRefusalFrom(html)).resolves.toBe("generic");
    await expect(passwordRefusalFrom(new Response(null, { status: 500 }))).resolves.toBe("generic");
  });
});

/**
 * The classification is keyed on `code` and reads no prose, asserted rather than
 * inferred (issue #910).
 *
 * The API's breach-corpus outage body used to end "set
 * QCMS_ADMIN_PASSWORD_BREACH_CHECK=false", which ADR-24 (widened by the Code Owner on
 * 2026-09-12) does not allow in a response body, and that sentence was rewritten on the
 * API side. Anything reading the message text would have moved with it. Nothing here
 * does, and these cases are what keeps that true: the same code classifies identically
 * with the old prose, the new prose, and no prose at all, so the next rewording of an API
 * sentence cannot change which sentence this admin renders.
 */
describe("the API's prose is never what decides the sentence", () => {
  /** The API's own `BREACH_LOOKUP_FAILED_CODE`, mirrored the way the ruled code is. */
  const BREACH_CORPUS_UNREACHABLE = "BREACH_CORPUS_UNREACHABLE";

  const bodies = [
    { label: "the pre-#910 prose, variable and all", message: "... set QCMS_X=false ..." },
    { label: "the rewritten operator-neutral prose", message: "Retry once that host is..." },
    { label: "no message at all", message: undefined },
  ];

  it.each(bodies)("classifies the outage code as generic with $label", ({ message }) => {
    // Generic is correct and is the point: SEC-1 allows exactly one specific sentence on
    // this form, and an availability failure is not it.
    expect(passwordRefusalOf({ code: BREACH_CORPUS_UNREACHABLE, message })).toBe("generic");
  });

  it.each(bodies)("classifies the corpus hit as compromised with $label", ({ message }) => {
    // The other direction, which is the one that would break a prose-reading classifier:
    // the ruled code still earns the specific sentence whatever the API says beside it.
    expect(passwordRefusalOf({ code: PASSWORD_COMPROMISED_CODE, message })).toBe("compromised");
  });

  it("gives the corpus-hit sentence to no body that merely quotes the prose", async () => {
    // The inverse guard: prose alone, without the code, must not reach the exception.
    const looksRight = refusal({
      message: "The password you entered has been compromised.",
      code: BREACH_CORPUS_UNREACHABLE,
    });
    await expect(passwordRefusalFrom(looksRight)).resolves.toBe("generic");
  });
});
