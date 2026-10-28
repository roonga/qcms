import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { registerAnonymousEntry } from "../features/responses/start-session/route.js";
import { internalTokenFor, makeDeps } from "../test-support.js";
import {
  INVALID_REQUEST,
  invalidRequest,
  type ValidationFailureDetails,
  validationErrorHook,
} from "./validation-hook.js";

const PUBLIC_ONLY = { public: true, internal: false, admin: false, environments: [] } as const;

interface EnvelopeBody {
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
}

function publicApp(): { app: ReturnType<typeof createApp>; token: string } {
  // No database: validation refuses the request before any handler queries.
  const deps = makeDeps();
  return {
    app: createApp(deps, PUBLIC_ONLY, { groups: { anonymous: [registerAnonymousEntry] } }),
    token: internalTokenFor(deps.config),
  };
}

async function postSessions(body: unknown): Promise<Response> {
  const { app, token } = publicApp();
  return app.request("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-qcms-internal-token": token },
    body: JSON.stringify(body),
  });
}

describe("a public route's schema refusal is an ErrorEnvelope (issue #182)", () => {
  it("400s a malformed body in the documented envelope shape, not a raw ZodError", async () => {
    const res = await postSessions({ formSlug: 42 });

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe(INVALID_REQUEST);
    expect(typeof body.error.message).toBe("string");
    expect(Object.keys(body)).toEqual(["error"]);

    const details = body.error.details as ValidationFailureDetails;
    expect(details.target).toBe("json");
    expect(details.issues).toEqual([{ path: "formSlug", code: "invalid_type" }]);
  });

  it("names the failing location without echoing any submitted value", async () => {
    const secret = "SENTINEL-caller-supplied-value";
    const res = await postSessions({ formSlug: secret, token: `${secret}-two` });

    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(raw).not.toContain("SENTINEL");

    const body = JSON.parse(raw) as EnvelopeBody;
    expect(body.error.code).toBe(INVALID_REQUEST);
    const details = body.error.details as ValidationFailureDetails;
    expect(details.issues).toEqual([
      { path: "(root)", code: "unrecognized_keys", keys: ["token"] },
    ]);
  });

  it("leaves a valid request alone: the hook only fires on a failure", () => {
    // Driven directly, because a body that validates reaches a handler that queries.
    expect(validationErrorHook({ target: "json", success: true })).toBeUndefined();
  });
});

describe("the envelope details are value-free by construction", () => {
  it("names the refused key but not the value that came with it (#893)", () => {
    const schema = z.strictObject({ keep: z.string() });
    const parsed = schema.safeParse({ keep: "ok", misspelled: "SENTINEL-caller-supplied" });
    if (parsed.success) throw new Error("fixture should not parse");

    const err = invalidRequest("json", parsed.error);
    expect(err.code).toBe(INVALID_REQUEST);
    expect(err.status).toBe(400);
    expect(err.message).toContain('"misspelled"');
    expect(err.details).toEqual({
      target: "json",
      issues: [{ path: "(root)", code: "unrecognized_keys", keys: ["misspelled"] }],
    });
    expect(JSON.stringify(err.toEnvelope())).not.toContain("SENTINEL");
  });

  it("reduces a path segment that does not read as a field name to `*`", () => {
    // A `z.record` keys its children by whatever the caller sent, so a path segment
    // can carry input rather than a schema-declared name.
    const schema = z.object({ answers: z.record(z.string(), z.number()) });
    const parsed = schema.safeParse({ answers: { q_ok: 1, "a caller's free text": "no" } });
    if (parsed.success) throw new Error("fixture should not parse");

    const details = invalidRequest("json", parsed.error).details as ValidationFailureDetails;
    expect(details.issues).toEqual([{ path: "answers.*", code: "invalid_type" }]);
  });

  it("keeps array indices, which are positions rather than content", () => {
    const schema = z.object({ steps: z.array(z.string()) });
    const parsed = schema.safeParse({ steps: ["ok", 7] });
    if (parsed.success) throw new Error("fixture should not parse");

    const details = invalidRequest("json", parsed.error).details as ValidationFailureDetails;
    expect(details.issues).toEqual([{ path: "steps.1", code: "invalid_type" }]);
  });

  it("caps the reported issues and counts what it dropped", () => {
    const shape: Record<string, z.ZodString> = {};
    for (let i = 0; i < 25; i += 1) shape[`f${String(i)}`] = z.string();
    const parsed = z.object(shape).safeParse({});
    if (parsed.success) throw new Error("fixture should not parse");

    const details = invalidRequest("json", parsed.error).details as ValidationFailureDetails;
    expect(details.issues).toHaveLength(20);
    expect(details.omitted).toBe(5);
  });

  it("omits the dropped count when every issue is reported", () => {
    const parsed = z.object({ a: z.string() }).safeParse({});
    if (parsed.success) throw new Error("fixture should not parse");

    const details = invalidRequest("json", parsed.error).details as ValidationFailureDetails;
    expect(details.issues).toHaveLength(1);
    expect(details.omitted).toBeUndefined();
  });
});

describe("a named key is bounded, because it is attacker-controlled text (#893)", () => {
  function reportFor(body: Record<string, unknown>): ValidationFailureDetails {
    const parsed = z.strictObject({ keep: z.string().optional() }).safeParse(body);
    if (parsed.success) throw new Error("fixture should not parse");
    return invalidRequest("json", parsed.error).details as ValidationFailureDetails;
  }

  it("names at most five keys per issue and counts the rest", () => {
    const body: Record<string, unknown> = {};
    for (let i = 0; i < 9; i += 1) body[`extra${String(i)}`] = i;

    const details = reportFor(body);
    expect(details.issues[0]?.keys).toHaveLength(5);
    expect(details.issues[0]?.omittedKeys).toBe(4);
  });

  it("says in the message how many it did not name, rather than listing them all", () => {
    const body: Record<string, unknown> = {};
    for (let i = 0; i < 9; i += 1) body[`extra${String(i)}`] = i;

    const parsed = z.strictObject({ keep: z.string().optional() }).safeParse(body);
    if (parsed.success) throw new Error("fixture should not parse");
    expect(invalidRequest("json", parsed.error).message).toContain("and 4 more");
  });

  it("cuts an over-long key to a fixed size, marker included", () => {
    const details = reportFor({ ["k".repeat(500)]: 1 });
    const named = details.issues[0]?.keys?.[0] ?? "";

    expect(named).toHaveLength(64);
    expect(named.endsWith("...")).toBe(true);
  });

  it("cuts on code points, so an astral key keeps whole characters", () => {
    // The single leading ASCII character makes a 64-code-unit boundary land in the
    // middle of a surrogate pair rather than tidily between two.
    const named = reportFor({ [`a${"\u{1f600}".repeat(200)}`]: 1 }).issues[0]?.keys?.[0] ?? "";

    expect([...named]).toHaveLength(64);
    expect(named.endsWith("...")).toBe(true);
    expect(/[\uD800-\uDFFF]/u.test(named.replaceAll(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, ""))).toBe(
      false,
    );
  });

  it("removes characters that could forge a line in the log", () => {
    const details = reportFor({ "one\nwarn: forged​tail": 1 });

    expect(details.issues[0]?.keys).toEqual(["onewarn: forgedtail"]);
  });

  it("keeps the location-only message for a failure that is not an unknown key", () => {
    const parsed = z.strictObject({ keep: z.string() }).safeParse({ keep: 7 });
    if (parsed.success) throw new Error("fixture should not parse");

    const err = invalidRequest("json", parsed.error);
    expect(err.message).toBe("The request does not match this route's schema");
    expect(err.details).toEqual({
      target: "json",
      issues: [{ path: "keep", code: "invalid_type" }],
    });
  });

  it("still reduces a record key to `*`, because there the key is content (#182)", () => {
    // A key a schema refused is named; a key it accepted as map content is not.
    const schema = z.strictObject({ answers: z.record(z.string(), z.number()) });
    const parsed = schema.safeParse({ answers: { "a caller's free text": "no" } });
    if (parsed.success) throw new Error("fixture should not parse");

    const details = invalidRequest("json", parsed.error).details as ValidationFailureDetails;
    expect(details.issues).toEqual([{ path: "answers.*", code: "invalid_type" }]);
  });
});

describe("a real respondent route refuses an unknown key on the wire (#893)", () => {
  it("400s an unknown top-level key and names it, in the documented envelope", async () => {
    const res = await postSessions({ formSlug: "customer-feedback", bogusField: 1 });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe(INVALID_REQUEST);
    expect(body.error.message).toContain('"bogusField"');
    const details = body.error.details as ValidationFailureDetails;
    expect(details.issues).toEqual([
      { path: "(root)", code: "unrecognized_keys", keys: ["bogusField"] },
    ]);
  });

  it("still accepts the declared keys, so the route did not simply get stricter", async () => {
    const res = await postSessions({ formSlug: "" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.message).toBe("The request does not match this route's schema");
    expect((body.error.details as ValidationFailureDetails).issues).toEqual([
      { path: "formSlug", code: "too_small" },
    ]);
  });
});
