import { describe, expect, it } from "vitest";

import { readResult } from "../server/api-result.ts";
import { messages } from "../i18n/en.ts";

function refusal(details: unknown): Response {
  return new Response(
    JSON.stringify({ error: { code: "WEBHOOK_URL_REJECTED", message: "server prose", details } }),
    { status: 422, headers: { "content-type": "application/json" } },
  );
}

async function messageFor(details: unknown): Promise<string> {
  const result = await readResult(refusal(details));
  if (result.ok) throw new Error("expected a failure");
  return result.message;
}

const GENERAL = messages["ops.error.webhookUrlRejected"];

describe("the reason a webhook target was refused", () => {
  const REASONS = ["not-a-url", "unsupported-scheme", "https-required", "private-host"] as const;

  it("maps each of the four reasons to its own sentence", async () => {
    const sentences = await Promise.all(REASONS.map((reason) => messageFor({ reason })));

    expect(new Set(sentences).size).toBe(4);
    expect(sentences).not.toContain(GENERAL);
    for (const sentence of sentences) {
      for (const reason of REASONS) expect(sentence).not.toContain(reason);
      expect(sentence).not.toContain("server prose");
      expect(sentence).not.toContain("QCMS_");
    }
  });

  it.each([
    ["no details at all", undefined],
    ["details with no reason", {}],
    ["a reason this build has never heard of", { reason: "dns-rebind" }],
    ["a reason that is not a string", { reason: 7 }],
    ["a reason that is null", { reason: null }],
  ])("falls back to the sentence true of all four for %s", async (_label, details) => {
    expect(await messageFor(details)).toBe(GENERAL);
  });

  it("leaves a reason on any other code alone", async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: "WEBHOOK_NOT_FOUND",
          message: "server prose",
          details: { reason: "private-host" },
        },
      }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
    const result = await readResult(response);
    if (result.ok) throw new Error("expected a failure");
    expect(result.message).toBe(messages["ops.error.webhookNotFound"]);
  });
});
