import { createRoute, z } from "@hono/zod-openapi";
import {
  acceptTotpStep,
  claimStepUpAttempt,
  dropStepUp,
  hasFreshStepUp,
  recordStepUp,
  stepUpExpiresAt,
  type Executor,
} from "@roonga/qcms-db";
import type { Context } from "hono";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { errorResponses, jsonBody, withScopes, type ApiEnv } from "../../openapi.js";
import { verifyAccountPassword } from "../accounts/credential.js";
import { adminAuthFor } from "./route.js";
import { factorStep } from "./totp.js";

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

/** The session a step-up is bound to. */
export interface StepUpSession {
  readonly userId: string;
  readonly sessionId: string;
}

function sessionOf(c: Context<ApiEnv>): StepUpSession {
  const principal = c.get("adminPrincipal");
  if (principal?.sessionId === undefined) throw fail.noSession();
  return { userId: principal.userId, sessionId: principal.sessionId };
}

/** Refuse unless `session` stepped up within the last five minutes, read on `exec`. */
export async function requireStepUpOn(
  exec: Executor,
  deps: Deps,
  session: StepUpSession,
): Promise<void> {
  const fresh = await hasFreshStepUp(exec, { ...session, now: deps.clock.now() });
  if (!fresh) throw fail.required();
}

/** Refuse unless the request's own session stepped up within the last five minutes. */
export async function requireStepUp(deps: Deps, c: Context<ApiEnv>): Promise<StepUpSession> {
  const session = sessionOf(c);
  await requireStepUpOn(deps.databases.control, deps, session);
  return session;
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
    if (!(await claimStepUpAttempt(exec, { sessionId, userId }))) throw fail.locked();

    const auth = adminAuthFor(deps);
    const { secretConfig } = await auth.$context;
    // Both halves always run, so the time taken does not say which one was wrong.
    const [passwordOk, step] = await Promise.all([
      verifyAccountPassword(auth, userId, body.password),
      factorStep(exec, secretConfig, { userId, code: body.code, verifiedOnly: true }),
    ]);
    const spent =
      passwordOk &&
      step !== undefined &&
      (await acceptTotpStep(exec, { userId, step, verifiedOnly: true }));
    if (!spent) {
      await dropStepUp(exec, sessionId);
      throw fail.refused();
    }
    const at = deps.clock.now();
    await recordStepUp(exec, { sessionId, userId, at });
    return c.json({ expiresAt: stepUpExpiresAt(at).toISOString() }, 200);
  });
};
