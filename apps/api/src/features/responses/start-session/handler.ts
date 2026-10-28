/**
 * The environment is the group's, never the request's: each respondent group is pinned
 * with `fixedEnvironment`, so a respondent has nothing to send that could change it.
 *
 * A version is resolved once, here, and `createSession` is the only path that sets one,
 * so nothing can re-pin a session already open (I4).
 */

import type { RouteHandler } from "@hono/zod-openapi";
import { importCompactTokenKey, verifySecureLink } from "@roonga/qcms-core";
import type { FormId, LinkId, SessionId } from "@roonga/qcms-core";
import {
  consumeSecureLink,
  createSession,
  getForm,
  getFormBySlug,
  getFormEnvironmentState,
  getSecureLink,
  getSession,
  sessionExpiresAt,
} from "@roonga/qcms-db";
import type {
  Executor,
  FormEnvironmentState,
  SecureLinkRow,
  SessionTtlConfig,
} from "@roonga/qcms-db";

import type { Config } from "../../../config.js";
import type { Deps } from "../../../deps.js";
import type { RequestDatabase } from "../../../environments.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import { clientIp } from "../rate-limits.js";
import { authenticateSession, importSessionKeys, mintSessionToken } from "../session-token.js";
// Type-only, so there is no runtime import cycle with route.ts.
import type { getSessionRoute, startLinkSessionRoute, startSessionRoute } from "./route.js";
import { environmentChallengeVerifier } from "../challenge.js";

const fail = {
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  formClosed: (): ApiError => new ApiError("FORM_CLOSED", 409, "This form is closed"),
  /** 404, not 403: a respondent learns nothing about which environment the token is for. */
  linkWrongEnvironment: (): ApiError =>
    new ApiError("LINK_WRONG_ENVIRONMENT", 404, "This link is not valid here"),
  /** Deliberately does not distinguish "never published" from "not released here". */
  noPublishedVersion: (): ApiError =>
    new ApiError("NO_PUBLISHED_VERSION", 409, "This form has no published version"),
  linkInvalid: (): ApiError => new ApiError("LINK_INVALID", 400, "This link is not valid"),
  linkExpired: (): ApiError => new ApiError("LINK_EXPIRED", 403, "This link has expired"),
  linkConsumed: (): ApiError =>
    new ApiError("LINK_CONSUMED", 409, "This link has already been used"),
  linkRevoked: (): ApiError => new ApiError("LINK_REVOKED", 403, "This link has been revoked"),
  challengeFailed: (): ApiError =>
    new ApiError("CHALLENGE_REQUIRED", 403, "A valid challenge is required to start this session"),
} as const;

function newSessionId(): SessionId {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `ses_${hex}` as SessionId;
}

function ttlConfig(config: Config): SessionTtlConfig {
  return { anonymousTtlMs: config.ttl.anonymousSessionMs };
}

interface StartResult {
  sessionId: SessionId;
  sessionToken: string;
  formVersion: number;
  expiresAt: Date;
}

function created(result: StartResult): {
  sessionId: SessionId;
  sessionToken: string;
  formVersion: number;
  expiresAt: string;
} {
  return {
    sessionId: result.sessionId,
    sessionToken: result.sessionToken,
    formVersion: result.formVersion,
    expiresAt: result.expiresAt.toISOString(),
  };
}

/** Anonymous entry, mounted on `prod`'s respondent surface alone (SEC-14). */
export function makeStartSessionHandler(
  deps: Deps,
): RouteHandler<typeof startSessionRoute, ApiEnv> {
  return async (c) => {
    const body = c.req.valid("json");
    const now = deps.clock.now();
    const challenge: ChallengeContext = { token: body.challengeToken, ip: clientIp(c) };
    const request = deps.databases.forRequest(c.get("requestEnvironment"));

    return c.json(created(await startAnonymous(deps, request, body.formSlug, now, challenge)), 201);
  };
}

export function makeStartLinkSessionHandler(
  deps: Deps,
): RouteHandler<typeof startLinkSessionRoute, ApiEnv> {
  return async (c) => {
    const body = c.req.valid("json");
    const now = deps.clock.now();
    const challenge: ChallengeContext = { token: body.challengeToken, ip: clientIp(c) };
    const request = deps.databases.forRequest(c.get("requestEnvironment"));

    return c.json(
      created(await startFromSecureLink(deps, request, body.token, now, challenge)),
      201,
    );
  };
}

interface ChallengeContext {
  readonly token: string | undefined;
  readonly ip: string | undefined;
}

/** The provider row is read only when a form requires a challenge, so other requests pay nothing. */
async function enforceChallenge(
  deps: Deps,
  request: RequestDatabase,
  challengeRequired: boolean,
  challenge: ChallengeContext,
): Promise<void> {
  if (!challengeRequired) return;
  const verifier = await environmentChallengeVerifier(deps, request.exec, request.environment);
  const result = await verifier.verify(challenge.token, challenge.ip);
  if (!result.ok) throw fail.challengeFailed();
}

/**
 * Closed is checked before nothing-released, so a stopped intake says so. Called before
 * anything is spent: a closed environment consumes no one-time link and charges no
 * challenge.
 */
async function requireOpenEnvironment(
  request: RequestDatabase,
  formId: FormId,
): Promise<FormEnvironmentState> {
  const state = await getFormEnvironmentState(request.exec, formId, request.environment);
  if (state?.closed === true) throw fail.formClosed();
  if (state === undefined) throw fail.noPublishedVersion();
  return state;
}

async function startAnonymous(
  deps: Deps,
  request: RequestDatabase,
  formSlug: string,
  now: Date,
  challenge: ChallengeContext,
): Promise<StartResult> {
  const form = await getFormBySlug(request.exec, formSlug);
  if (form === undefined) throw fail.formNotFound();
  const released = await requireOpenEnvironment(request, form.formId);
  await enforceChallenge(deps, request, form.challengeRequired, challenge);

  const expiresAt = sessionExpiresAt({
    accessMode: "anonymous",
    now,
    config: ttlConfig(deps.config),
  });
  const sessionId = newSessionId();
  await createSession(request.exec, {
    sessionId,
    formId: form.formId,
    formVersion: released.version,
    accessMode: "anonymous",
    // The connection's own environment: the per-schema CHECK refuses a row that
    // disagrees, so a mismatch cannot land claiming to be elsewhere.
    environment: request.environment,
    expiresAt,
  });

  return finish(deps, sessionId, released.version, expiresAt);
}

async function startFromSecureLink(
  deps: Deps,
  request: RequestDatabase,
  token: string,
  now: Date,
  challenge: ChallengeContext,
): Promise<StartResult> {
  const keys = await importLinkKeys(deps.config);
  const verified = await verifySecureLink(token, keys, now);
  if (!verified.ok) {
    // The signature is checked before any claim in the token is trusted.
    throw verified.error.code === "EXPIRED" ? fail.linkExpired() : fail.linkInvalid();
  }
  const { formId, linkId, expiresAt: linkExpiresAtIso, oneTime } = verified.value;
  const linkExpiresAt = new Date(linkExpiresAtIso);

  const row = await getSecureLink(request.exec, linkId);
  // A validly-signed link with no server row was never minted here: a signature alone
  // is never sufficient (SEC-2).
  if (row === undefined) throw fail.linkInvalid();
  // Refused, never redirected: redirecting would turn a leaked production link into a
  // working one for anybody who found the test address. Ahead of `assertLinkUsable`,
  // because another environment's link state is not this environment's to report.
  if (row.environment !== request.environment) throw fail.linkWrongEnvironment();
  assertLinkUsable(row, now);

  // A closed environment overrides every link into it, and is checked before anything is
  // spent: no one-time link consumed, no challenge charged, no session created.
  const released = await requireOpenEnvironment(request, formId);
  const form = await getForm(request.exec, formId);
  await enforceChallenge(deps, request, form?.challengeRequired ?? false, challenge);

  // Session expiry never outlives the link, nor the TTL ceiling (SEC-2).
  const expiresAt = sessionExpiresAt({
    accessMode: "secure_link",
    now,
    linkExpiresAt,
    config: ttlConfig(deps.config),
  });
  const sessionId = newSessionId();

  if (oneTime === true) {
    // The CAS in `consumeSecureLink` lets exactly one of two concurrent starts win, and
    // the shared transaction means the loser leaves no orphan session.
    await request.exec.transaction(async (tx: Executor) => {
      const consumed = await consumeSecureLink(tx, linkId, now);
      if (consumed === undefined) throw fail.linkConsumed();
      await insertPinnedSession(tx, request.environment, {
        sessionId,
        formId,
        linkId,
        formVersion: released.version,
        expiresAt,
      });
    });
  } else {
    await insertPinnedSession(request.exec, request.environment, {
      sessionId,
      formId,
      linkId,
      formVersion: released.version,
      expiresAt,
    });
  }

  return finish(deps, sessionId, released.version, expiresAt);
}

/**
 * Server-side state, because signature validity is never enough on its own (SEC-2). Run
 * before the form's own state, so the refusal describes the link rather than the form.
 */
function assertLinkUsable(row: SecureLinkRow, now: Date): void {
  if (row.revokedAt !== null) throw fail.linkRevoked();
  if (row.consumedAt !== null) throw fail.linkConsumed();
  if (row.expiresAt.getTime() <= now.getTime()) throw fail.linkExpired();
}

/**
 * The version is resolved before the one-time consumption, so this insert shares its
 * transaction with no read that could refuse after the link was spent.
 */
async function insertPinnedSession(
  exec: Executor,
  environment: string,
  session: {
    sessionId: SessionId;
    formId: FormId;
    linkId: LinkId;
    formVersion: number;
    expiresAt: Date;
  },
): Promise<void> {
  await createSession(exec, {
    sessionId: session.sessionId,
    formId: session.formId,
    formVersion: session.formVersion,
    accessMode: "secure_link",
    linkId: session.linkId,
    // The composite foreign key requires the link's row to name this same environment,
    // so a link minted for another one cannot start a session here.
    environment,
    expiresAt: session.expiresAt,
  });
}

async function finish(
  deps: Deps,
  sessionId: SessionId,
  formVersion: number,
  expiresAt: Date,
): Promise<StartResult> {
  const [signingKey] = await importSessionKeys(deps.config);
  if (signingKey === undefined) {
    // Boot config guarantees a key, so this is a bug and not a client-safe refusal.
    throw new Error("no session signing key configured");
  }
  const sessionToken = await mintSessionToken(sessionId, expiresAt, signingKey);
  return { sessionId, sessionToken, formVersion, expiresAt };
}

async function importLinkKeys(config: Config): Promise<CryptoKey[]> {
  return Promise.all(
    config.keys.link.map((raw) => importCompactTokenKey(new TextEncoder().encode(raw))),
  );
}

/** The token must bind the `id` in the path: possession of a session id grants nothing (SEC-2). */
export function makeGetSessionHandler(deps: Deps): RouteHandler<typeof getSessionRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const authedSessionId = await authenticateSession(c, deps);
    if (authedSessionId !== id) {
      throw new ApiError("unauthorized", 401, "Session token does not match this session");
    }

    const session = await getSession(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      authedSessionId,
    );
    if (session === undefined) throw new ApiError("SESSION_NOT_FOUND", 404, "No such session");

    return c.json(
      {
        sessionId: session.sessionId,
        status: session.status,
        formVersion: session.formVersion,
        expiresAt: session.expiresAt.toISOString(),
        position: null,
      },
      200,
    );
  };
}
