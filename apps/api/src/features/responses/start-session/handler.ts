/**
 * Start-session handlers (task 018) - the respondent's front door.
 *
 * This is a **transaction script** (R5): the only kernel calls are token
 * verify/mint (`verifySecureLink`, `mintSessionToken`); everything else is
 * shape-preserving `@roonga/qcms-db` reads/writes the slice sequences and whose
 * transaction boundary it owns (R3). Handlers are fetch-pure (R4): time via
 * `deps.clock`, crypto via WebCrypto, no `node:*`.
 *
 * Two entry modes (SEC-2):
 *
 * - **Anonymous** (`{ formSlug }`): the form must exist, be `open`, and have a version
 *   **released to this environment** → a session pinned to that version, TTL from config.
 * - **Secure link** (`{ token }`): the token verifies under `QCMS_LINK_KEYS`,
 *   the `secure_links` row must agree (not revoked; one-time links are consumed
 *   atomically - a signature alone is never sufficient), and the form must be
 *   `open` (the whole-form closed state overrides every link, ADR-39) → a
 *   session pinned to the version released to this environment, expiring at
 *   `min(link expiry, session TTL)` so it never outlives the token (SEC-2).
 *
 * **What a new session resolves is what is released here, not the newest published
 * version** (ADR-40, task 065). A version lives once in `control` and is shared by every
 * environment (ADR-18); what varies per environment is which version is released there,
 * so a version released to `test` and not to `prod` is served in `test` and refused in
 * `prod`. The read is `getReleasedVersion` on the request's own environment pool, which
 * holds `SELECT` on `control.form_releases` (Q48's read list).
 *
 * **A release never re-pins a session already open** (ADR-07, invariant I4, Q5). The
 * resolution below happens once, at start; nothing re-reads it for a live session, and
 * there is no write path that could move a pin.
 *
 * Every pinning insert goes through `createSession`, whose `(formId,
 * formVersion)` write is the sole path that sets a session's version - that
 * absence of a re-pin path is how I4 (a session never migrates versions) holds.
 */

import type { RouteHandler } from "@hono/zod-openapi";
import { importCompactTokenKey, verifySecureLink } from "@roonga/qcms-core";
import type { FormId, LinkId, SessionId } from "@roonga/qcms-core";
import {
  consumeSecureLink,
  createSession,
  getForm,
  getFormBySlug,
  getReleasedVersion,
  getSecureLink,
  getSession,
  sessionExpiresAt,
} from "@roonga/qcms-db";
import type { Executor, SecureLinkRow, SessionTtlConfig } from "@roonga/qcms-db";

import type { Config } from "../../../config.js";
import type { Deps } from "../../../deps.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import { clientIp } from "../rate-limits.js";
import { authenticateSession, importSessionKeys, mintSessionToken } from "../session-token.js";
// Type-only (erased at runtime, so no import cycle with route.ts): binds each
// handler to its route so `c.json(...)` yields the route's typed response.
import type { getSessionRoute, startSessionRoute } from "./route.js";

// --- typed failures (envelope codes the portal keys off, 029) ---------------

const fail = {
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  formClosed: (): ApiError => new ApiError("FORM_CLOSED", 409, "This form is closed"),
  /**
   * No version of this form is **released to this environment** (ADR-40).
   *
   * The code and the status are unchanged from when the resolution was "the newest
   * published version", deliberately: a respondent is told the form is not available
   * here, and which of "never published" and "published but not released here" it is is
   * not a distinction a respondent-facing code should draw. The message says the same
   * thing the code has always said, and the operator's answer is on the release screens.
   */
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

/** A fresh, branded session id: `ses_` + 16 random hex bytes (matches `^ses_[a-z0-9_]+$`). */
function newSessionId(): SessionId {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `ses_${hex}` as SessionId;
}

/** The @roonga/qcms-db TTL policy for the API's configured anonymous session lifetime. */
function ttlConfig(config: Config): SessionTtlConfig {
  return { anonymousTtlMs: config.ttl.anonymousSessionMs };
}

interface StartResult {
  sessionId: SessionId;
  sessionToken: string;
  formVersion: number;
  expiresAt: Date;
}

/**
 * `POST /sessions`. Delegates to the anonymous or secure-link script by which
 * field the (already-validated: exactly one) body carries, then mints the
 * binding session token. 201 Created.
 */
export function makeStartSessionHandler(
  deps: Deps,
): RouteHandler<typeof startSessionRoute, ApiEnv> {
  return async (c) => {
    const body = c.req.valid("json");
    const now = deps.clock.now();
    const challenge: ChallengeContext = { token: body.challengeToken, ip: clientIp(c) };

    const result =
      body.token !== undefined
        ? await startFromSecureLink(deps, body.token, now, challenge)
        : await startAnonymous(deps, body.formSlug ?? "", now, challenge);

    return c.json(
      {
        sessionId: result.sessionId,
        sessionToken: result.sessionToken,
        formVersion: result.formVersion,
        expiresAt: result.expiresAt.toISOString(),
      },
      201,
    );
  };
}

/** The challenge inputs threaded from the request: the client's solution + IP. */
interface ChallengeContext {
  readonly token: string | undefined;
  readonly ip: string | undefined;
}

/**
 * Enforce a form's `challengeRequired` setting (task 026). When set, the
 * configured {@link Deps.challenge} verifier must pass for the request's
 * challenge token; a failure rejects start-session with 403. With provider
 * `none` the null verifier accepts everything, so the setting no-ops - the
 * check still runs (structurally honored) but never blocks.
 */
async function enforceChallenge(
  deps: Deps,
  challengeRequired: boolean,
  challenge: ChallengeContext,
): Promise<void> {
  if (!challengeRequired) return;
  const result = await deps.challenge.verify(challenge.token, challenge.ip);
  if (!result.ok) throw fail.challengeFailed();
}

async function startAnonymous(
  deps: Deps,
  formSlug: string,
  now: Date,
  challenge: ChallengeContext,
): Promise<StartResult> {
  const form = await getFormBySlug(deps.databases.forRequest().exec, formSlug);
  if (form === undefined) throw fail.formNotFound();
  if (form.status === "closed") throw fail.formClosed();
  await enforceChallenge(deps, form.challengeRequired, challenge);

  const request = deps.databases.forRequest();
  const released = await getReleasedVersion(request.exec, form.formId, request.environment);
  if (released === undefined) throw fail.noPublishedVersion();

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
    // The connection's own environment (Q46). The row lands in `data_<env>` by search
    // path and the per-schema CHECK refuses it if the two disagree, so a mismatch is a
    // constraint violation rather than a row that quietly claims to be elsewhere.
    environment: request.environment,
    expiresAt,
  });

  return finish(deps, sessionId, released.version, expiresAt);
}

async function startFromSecureLink(
  deps: Deps,
  token: string,
  now: Date,
  challenge: ChallengeContext,
): Promise<StartResult> {
  const keys = await importLinkKeys(deps.config);
  const verified = await verifySecureLink(token, keys, now);
  if (!verified.ok) {
    // MALFORMED / BAD_SIGNATURE / WRONG_PURPOSE / WRONG_FORM → invalid;
    // EXPIRED → expired. The signature is checked before any claim is trusted.
    throw verified.error.code === "EXPIRED" ? fail.linkExpired() : fail.linkInvalid();
  }
  const { formId, linkId, expiresAt: linkExpiresAtIso, oneTime } = verified.value;
  const linkExpiresAt = new Date(linkExpiresAtIso);

  const row = await getSecureLink(deps.databases.forRequest().exec, linkId);
  // A validly-signed link with no server row was never minted here - reject it
  // as invalid rather than trusting the token alone (SEC-2).
  if (row === undefined) throw fail.linkInvalid();
  assertLinkUsable(row, now);

  // The whole-form closed state overrides every link, secure ones included
  // (ADR-39, issue #724). It is checked here, after the link's own state and
  // before anything is spent: a closed form must not consume a one-time link,
  // charge a challenge, or create a session.
  //
  // A form may also require a challenge even for invited (secure-link) entry;
  // the setting is per-form (task 026). One read of the identity row serves both.
  const form = await getForm(deps.databases.forRequest().exec, formId);
  if (form?.status === "closed") throw fail.formClosed();
  await enforceChallenge(deps, form?.challengeRequired ?? false, challenge);

  // Session expiry never outlives the link, nor the anonymous TTL ceiling
  // (SEC-2). The min(link, now + TTL) policy lives in the @roonga/qcms-db helper so
  // this slice and any future resume/extend caller stay consistent (issue #6).
  const expiresAt = sessionExpiresAt({
    accessMode: "secure_link",
    now,
    linkExpiresAt,
    config: ttlConfig(deps.config),
  });
  const sessionId = newSessionId();
  const request = deps.databases.forRequest();

  let formVersion: number;
  if (oneTime === true) {
    // One-time: consume + create in one transaction. The CAS in
    // `consumeSecureLink` makes exactly one of two concurrent starts win; the
    // loser matches no row → LINK_CONSUMED and the transaction rolls back so no
    // orphan session is created.
    formVersion = await request.exec.transaction(async (tx) => {
      const consumed = await consumeSecureLink(tx, linkId, now);
      if (consumed === undefined) throw fail.linkConsumed();
      return insertPinnedSession(tx, request.environment, sessionId, formId, linkId, expiresAt);
    });
  } else {
    formVersion = await insertPinnedSession(
      request.exec,
      request.environment,
      sessionId,
      formId,
      linkId,
      expiresAt,
    );
  }

  return finish(deps, sessionId, formVersion, expiresAt);
}

/**
 * Reject a secure link whose server-side state forbids use: revoked, already
 * consumed (one-time replay), or past its stored expiry. Signature validity is
 * never enough on its own (SEC-2).
 *
 * These run before the form's own state (issue #724). The credential is settled
 * first, so a dead link never reads form state, and the refusal a recipient sees
 * stays the one that describes their link: revocation and consumption are
 * permanent for that link, while a closed form reopens.
 */
function assertLinkUsable(row: SecureLinkRow, now: Date): void {
  if (row.revokedAt !== null) throw fail.linkRevoked();
  if (row.consumedAt !== null) throw fail.linkConsumed();
  if (row.expiresAt.getTime() <= now.getTime()) throw fail.linkExpired();
}

/**
 * Insert a version-pinned secure-link session, resolving **what is released to this
 * environment** first (ADR-40, I4). Returns the pinned version number.
 *
 * The environment is the connection's own, which is also the environment the link's row
 * names - the composite foreign key refuses the pair otherwise - so the release this
 * reads is the release of the environment the session is about to land in.
 */
async function insertPinnedSession(
  exec: Executor,
  environment: string,
  sessionId: SessionId,
  formId: FormId,
  linkId: LinkId,
  expiresAt: Date,
): Promise<number> {
  const released = await getReleasedVersion(exec, formId, environment);
  if (released === undefined) throw fail.noPublishedVersion();
  await createSession(exec, {
    sessionId,
    formId,
    formVersion: released.version,
    accessMode: "secure_link",
    linkId,
    // The connection's own environment (Q46). With a link, the composite foreign key
    // additionally requires the link's own row to name the same one, so a link minted
    // for another environment cannot start a session here however the request arrived.
    environment,
    expiresAt,
  });
  return released.version;
}

/** Mint the binding session token and assemble the response payload. */
async function finish(
  deps: Deps,
  sessionId: SessionId,
  formVersion: number,
  expiresAt: Date,
): Promise<StartResult> {
  const [signingKey] = await importSessionKeys(deps.config);
  if (signingKey === undefined) {
    // Boot config guarantees ≥1 session key; a bug here is not client-safe.
    throw new Error("no session signing key configured");
  }
  const sessionToken = await mintSessionToken(sessionId, expiresAt, signingKey);
  return { sessionId, sessionToken, formVersion, expiresAt };
}

/** Import the `QCMS_LINK_KEYS` list as verify keys (newest first). */
async function importLinkKeys(config: Config): Promise<CryptoKey[]> {
  return Promise.all(
    config.keys.link.map((raw) => importCompactTokenKey(new TextEncoder().encode(raw))),
  );
}

/**
 * `GET /sessions/{id}` - the resume/status view. Session-token authed: the
 * bearer token must verify (`purpose: "session"`) *and* bind the `id` in the
 * path (possession of an id alone grants nothing, SEC-2 §3).
 */
export function makeGetSessionHandler(deps: Deps): RouteHandler<typeof getSessionRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const authedSessionId = await authenticateSession(c, deps);
    if (authedSessionId !== id) {
      // Token is valid but for a different session - no cross-session read.
      throw new ApiError("unauthorized", 401, "Session token does not match this session");
    }

    const session = await getSession(deps.databases.forRequest().exec, authedSessionId);
    if (session === undefined) throw new ApiError("SESSION_NOT_FOUND", 404, "No such session");

    return c.json(
      {
        sessionId: session.sessionId,
        status: session.status,
        formVersion: session.formVersion,
        expiresAt: session.expiresAt.toISOString(),
        // Reserved for the forward-pass flow position; 019 (get-step) fills it.
        position: null,
      },
      200,
    );
  };
}
