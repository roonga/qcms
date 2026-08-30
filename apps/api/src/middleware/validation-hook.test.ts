/**
 * Route-schema validation refusals go through the error envelope (issue #182).
 *
 * Two layers, because the defect had two halves. The composed-app tests drive a
 * **real** public slice through `app.request()` and pin what reaches the wire:
 * the `ErrorEnvelope` shape every route documents, at 400, with no submitted
 * value in it. The unit tests pin the value-free property against the issue
 * kinds a route schema could produce in future - notably `unrecognized_keys`,
 * whose raw `ZodError` names the keys it was sent, which is the concrete SEC-8
 * echo the hook exists to stop.
 *
 * The admin half of the surface is covered where a real admin session exists:
 * the gate rejects an unauthenticated request before any validator runs, so the
 * admin assertion lives in `features/forms/forms.integration.test.ts`.
 */

import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { registerStartSession } from "../features/responses/start-session/route.js";
import { internalTokenFor, makeDeps } from "../test-support.js";
import {
  INVALID_REQUEST,
  invalidRequest,
  type ValidationFailureDetails,
  validationErrorHook,
} from "./validation-hook.js";

const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;

interface EnvelopeBody {
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
}

/** A public app carrying the real start-session slice; no database is reached. */
function publicApp(): { app: ReturnType<typeof createApp>; token: string } {
  // `unusedDb`: validation refuses the request before any handler queries.
  const deps = makeDeps();
  return {
    app: createApp(deps, PUBLIC_ONLY, { groups: { public: [registerStartSession] } }),
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
    // The pre-fix body was `{ success: false, error: { name: "ZodError", ... } }`,
    // so `error.code` read back `undefined` for every client keying off it.
    expect(body.error.code).toBe(INVALID_REQUEST);
    expect(typeof body.error.message).toBe("string");
    expect(Object.keys(body)).toEqual(["error"]);

    const details = body.error.details as ValidationFailureDetails;
    expect(details.target).toBe("json");
    expect(details.issues).toEqual([{ path: "formSlug", code: "invalid_type" }]);
  });

  it("names the failing location without echoing any submitted value", async () => {
    // Both fields present violates the slice's exclusive-choice refinement, so
    // the whole body is the failing location and both values were rejected.
    const secret = "SENTINEL-caller-supplied-value";
    const res = await postSessions({ formSlug: secret, token: `${secret}-two` });

    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(raw).not.toContain("SENTINEL");

    const body = JSON.parse(raw) as EnvelopeBody;
    expect(body.error.code).toBe(INVALID_REQUEST);
    const details = body.error.details as ValidationFailureDetails;
    expect(details.issues).toEqual([{ path: "(root)", code: "custom" }]);
  });

  it("leaves a valid request alone: the hook only fires on a failure", () => {
    // Driven directly rather than through a composed app: a body that validates
    // reaches the handler, and every handler on this slice queries the database.
    expect(validationErrorHook({ target: "json", success: true })).toBeUndefined();
  });
});

describe("the envelope details are value-free by construction", () => {
  it("drops the submitted keys a raw unrecognized_keys issue would have echoed", () => {
    const schema = z.strictObject({ keep: z.string() });
    const parsed = schema.safeParse({ keep: "ok", leaked: "caller-supplied" });
    if (parsed.success) throw new Error("fixture should not parse");

    // The raw error is the pre-fix wire body, and it carries the caller's key.
    expect(JSON.stringify(parsed.error)).toContain("leaked");

    const err = invalidRequest("json", parsed.error);
    expect(err.code).toBe(INVALID_REQUEST);
    expect(err.status).toBe(400);
    expect(JSON.stringify(err.toEnvelope())).not.toContain("leaked");
    expect(err.details).toEqual({
      target: "json",
      issues: [{ path: "(root)", code: "unrecognized_keys" }],
    });
  });

  it("reduces a path segment that does not read as a field name to `*`", () => {
    // A `z.record` keys its children by whatever the caller sent, so a segment
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
