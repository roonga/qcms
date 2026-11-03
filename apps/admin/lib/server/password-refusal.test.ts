import { describe, expect, it } from "vitest";

import {
  PASSWORD_COMPROMISED_CODE,
  passwordRefusalFrom,
  passwordRefusalOf,
} from "./password-refusal.ts";

const CORPUS_HIT = {
  code: PASSWORD_COMPROMISED_CODE,
  message: "The password you entered has been compromised.",
};

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
    const html = new Response("<html>502</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    await expect(passwordRefusalFrom(html)).resolves.toBe("generic");
    await expect(passwordRefusalFrom(new Response(null, { status: 500 }))).resolves.toBe("generic");
  });
});

describe("the API's prose is never what decides the sentence", () => {
  const BREACH_CORPUS_UNREACHABLE = "BREACH_CORPUS_UNREACHABLE";

  const bodies = [
    { label: "the pre-#910 prose, variable and all", message: "... set QCMS_X=false ..." },
    { label: "the rewritten operator-neutral prose", message: "Retry once that host is..." },
    { label: "no message at all", message: undefined },
  ];

  it.each(bodies)("classifies the outage code as generic with $label", ({ message }) => {
    expect(passwordRefusalOf({ code: BREACH_CORPUS_UNREACHABLE, message })).toBe("generic");
  });

  it.each(bodies)("classifies the corpus hit as compromised with $label", ({ message }) => {
    expect(passwordRefusalOf({ code: PASSWORD_COMPROMISED_CODE, message })).toBe("compromised");
  });

  it("gives the corpus-hit sentence to no body that merely quotes the prose", async () => {
    const looksRight = refusal({
      message: "The password you entered has been compromised.",
      code: BREACH_CORPUS_UNREACHABLE,
    });
    await expect(passwordRefusalFrom(looksRight)).resolves.toBe("generic");
  });
});
