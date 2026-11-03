import { describe, expect, it } from "vitest";

import { errorForResponse, messageForError } from "./assist-errors.ts";

describe("errorForResponse", () => {
  it("reads a rate limit's retry hint when the header carries one", async () => {
    const response = new Response("", { status: 429, headers: { "retry-after": "12" } });
    expect(await errorForResponse(response)).toEqual({ kind: "RATE_LIMITED", retryAfter: "12" });
  });

  it("reads a rate limit with no hint as the plain refusal", async () => {
    expect(await errorForResponse(new Response("", { status: 429 }))).toEqual({
      kind: "RATE_LIMITED",
    });
  });

  it("reads a conflict as a stale draft, which is what the builder route means by it", async () => {
    expect(await errorForResponse(new Response("", { status: 409 }))).toEqual({
      kind: "STALE_DRAFT",
    });
  });

  it("relays the route's own message when the body carries one", async () => {
    const body = JSON.stringify({ error: { message: "That screen is not in the registry." } });
    const failure = await errorForResponse(new Response(body, { status: 400 }));
    expect(failure).toEqual({ kind: "HTTP", message: "That screen is not in the registry." });
    expect(messageForError(failure)).toContain("That screen is not in the registry.");
  });

  it("falls back to the status number when the body is not JSON at all", async () => {
    const failure = await errorForResponse(new Response("<html>502</html>", { status: 502 }));
    expect(failure).toEqual({ kind: "HTTP", message: "502" });
    expect(messageForError(failure)).toContain("502");
  });
});
