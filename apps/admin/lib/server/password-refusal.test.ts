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
