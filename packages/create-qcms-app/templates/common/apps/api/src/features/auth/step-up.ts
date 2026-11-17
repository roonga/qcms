import { createRoute, z } from "@hono/zod-openapi";
import {
  authTwoFactor,
  hasFreshStepUp,
  recordStepUp,
  recordStepUpFailure,
  stepUpExpiresAt,
  stepUpLocked,
} from "@roonga/qcms-db";
// eslint-disable-next-line no-restricted-imports -- the vendor's own cipher module, not Node's; the built-in fence matches its `crypto` segment
import { symmetricDecrypt } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { errorResponses, jsonBody, withScopes, type ApiEnv } from "../../openapi.js";
import { verifyAccountPassword } from "../accounts/credential.js";
import { adminAuthFor } from "./route.js";

const TOTP_PERIOD_S = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;

const fail = {
  noSession: (): ApiError =>
    new ApiError("STEP_UP_REQUIRED", 403, "This act needs a step-up on a signed-in session."),
  required: (): ApiError =>
    new ApiError(
      "STEP_UP_REQUIRED",
      403,
      "Confirm your password and second factor first. A confirmation lasts five minutes " +
        "and holds only for the session that made it.",
    ),
  refused: (): ApiError =>
    new ApiError("STEP_UP_FAILED", 403, "That password and code did not confirm you."),
  locked: (): ApiError =>
    new ApiError(
      "STEP_UP_LOCKED",
      403,
      "Too many failed confirmations on this session. Sign in again to try once more.",
    ),
} as const;

async function hotp(key: CryptoKey, counter: number): Promise<string> {
  const message = new ArrayBuffer(8);
  new DataView(message).setBigUint64(0, BigInt(counter), false);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = (mac[mac.length - 1] ?? 0) & 0xf;
  const word =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return (word % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
}

/** RFC 6238 over the secret the vendor enrolled, with the vendor's period, digits and window. */
async function totpMatches(secret: string, code: string, now: Date): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const counter = Math.floor(now.getTime() / (TOTP_PERIOD_S * 1000));
  let matched = false;
  for (let step = -TOTP_WINDOW; step <= TOTP_WINDOW; step += 1) {
    const expected = await hotp(key, counter + step);
    let difference = expected.length ^ code.length;
    for (let i = 0; i < expected.length; i += 1) {
      difference |= expected.charCodeAt(i) ^ code.charCodeAt(i);
    }
    matched = difference === 0 || matched;
  }
  return matched;
}

async function factorMatches(deps: Deps, userId: string, code: string): Promise<boolean> {
  const [factor] = await deps.databases.control
    .select({ secret: authTwoFactor.secret })
    .from(authTwoFactor)
    .where(and(eq(authTwoFactor.userId, userId), eq(authTwoFactor.verified, true)))
    .limit(1);
  if (factor === undefined) return false;
  const ctx = await adminAuthFor(deps).$context;
  const secret = await symmetricDecrypt({ key: ctx.secretConfig, data: factor.secret });
  // An imported secret is stored base32-prefixed; QCMS only ever enrols generated ones.
  if (secret.startsWith("base32:")) return false;
  // Wall time, not the injected clock: the code on the person's device is.
  return totpMatches(secret, code, new Date());
}

function sessionOf(c: Context<ApiEnv>): { readonly userId: string; readonly sessionId: string } {
  const principal = c.get("adminPrincipal");
  if (principal?.sessionId === undefined) throw fail.noSession();
  return { userId: principal.userId, sessionId: principal.sessionId };
}

/** Refuse unless the request's own session stepped up within the last five minutes. */
export async function requireStepUp(deps: Deps, c: Context<ApiEnv>): Promise<void> {
  const { userId, sessionId } = sessionOf(c);
  const fresh = await hasFreshStepUp(deps.databases.control, {
    sessionId,
    userId,
    now: deps.clock.now(),
  });
  if (!fresh) throw fail.required();
}

const StepUpBody = z
  .strictObject({
    password: z.string().min(1).max(1024),
    code: z.string().regex(/^\d{6}$/),
  })
  .openapi("StepUpBody");

const StepUpResponse = z.object({ expiresAt: z.iso.datetime() }).openapi("StepUpResponse");

export const stepUpRoute = createRoute({
  method: "post",
  path: "/step-up",
  summary: "Confirm your password and second factor for the next five minutes (Site administrator)",
  description:
    "Binds a step-up to the session the request rides on, for five minutes: promoting or " +
    "demoting a Site administrator, disabling or resetting one, and approving a site " +
    "request each need one. Another session never inherits it. Five failures lock the " +
    "session out of stepping up; a failure never says which half was wrong.",
  tags: ["auth"],
  request: { body: jsonBody(StepUpBody) },
  responses: {
    200: {
      description: "Stepped up until the time given",
      content: { "application/json": { schema: StepUpResponse } },
    },
    ...errorResponses(400, 401, 403),
  },
  ...withScopes("forms:write"),
});

export const registerStepUp: SliceRegistrar = (group, deps) => {
  group.openapi(stepUpRoute, async (c) => {
    const { userId, sessionId } = sessionOf(c);
    const body = c.req.valid("json");
    const exec = deps.databases.control;
    if (await stepUpLocked(exec, sessionId)) throw fail.locked();

    const passwordOk = await verifyAccountPassword(adminAuthFor(deps), userId, body.password);
    const codeOk = passwordOk && (await factorMatches(deps, userId, body.code));
    if (!codeOk) {
      await recordStepUpFailure(exec, { sessionId, userId });
      throw fail.refused();
    }
    const at = deps.clock.now();
    await recordStepUp(exec, { sessionId, userId, at });
    return c.json({ expiresAt: stepUpExpiresAt(at).toISOString() }, 200);
  });
};
