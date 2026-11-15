import { describe, expect, it } from "vitest";

import { CLAIM_LINK_REFUSED_CODE, claimRefusalOf } from "./claim.ts";
import { PASSWORD_COMPROMISED_CODE } from "./password-refusal.ts";

function refusal(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

describe("reading a claim refusal", () => {
  it("names the spent link, so the screen drops a token that cannot work again", async () => {
    await expect(
      claimRefusalOf(refusal({ error: { code: CLAIM_LINK_REFUSED_CODE } })),
    ).resolves.toBe("link");
  });

  it("names the breach-corpus refusal, which earns its own specific message", async () => {
    await expect(
      claimRefusalOf(refusal({ error: { code: PASSWORD_COMPROMISED_CODE } })),
    ).resolves.toBe("compromised");
  });

  it("stays generic for every other code, and for a body that is not the envelope", async () => {
    await expect(claimRefusalOf(refusal({ error: { code: "SOMETHING_ELSE" } }))).resolves.toBe(
      "generic",
    );
    await expect(claimRefusalOf(refusal({ code: CLAIM_LINK_REFUSED_CODE }))).resolves.toBe(
      "generic",
    );
    await expect(claimRefusalOf(new Response("not json", { status: 400 }))).resolves.toBe(
      "generic",
    );
  });
});
