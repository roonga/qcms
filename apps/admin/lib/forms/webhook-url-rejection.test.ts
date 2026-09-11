import { describe, expect, it } from "vitest";

import { readResult } from "../server/api-result.ts";
import { messages } from "../i18n/en.ts";

/**
 * `details.reason` picks the sentence, and everything else falls back (issue #756).
 *
 * The rendered half is `components/ops/webhook-url-rejection.test.tsx`. This file covers
 * what a rendered test cannot reach cheaply: the shapes `details` can arrive in that are
 * not one of the four reasons. All of them have to produce the general sentence, because
 * it is true of every rejection the guard makes - and none of them may produce a blank, a
 * literal `{reason}` brace, or the machine token itself in front of an author.
 *
 * The fallback is the seam with `apps/api/src/features/webhooks/ssrf.ts`, which owns the
 * enum. `apps/*` never import each other, so the union in `errors.ts` is a copy; a fifth
 * reason added there would arrive here unrecognised, and this file is the statement that
 * the copy going stale degrades rather than breaks.
 */

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

    // Four distinct sentences, none of them the one that covers all four. A Set rather
    // than six inequalities: the defect #312 named is two reasons reading alike, and any
    // pair collapsing fails this line.
    expect(new Set(sentences).size).toBe(4);
    expect(sentences).not.toContain(GENERAL);
    for (const sentence of sentences) {
      // Neither the machine token nor the developer prose reaches an author (SEC-8),
      // and no flag value reaches a client (ADR-24).
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
