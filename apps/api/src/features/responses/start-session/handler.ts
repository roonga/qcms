/**
 * Start-session handlers (task 018) - the respondent's front door.
 *
 * This is a **transaction script** (R5): the only kernel calls are token
 * verify/mint (`verifySecureLink`, `mintSessionToken`); everything else is
 * shape-preserving `@roonga/qcms-db` reads/writes the slice sequences and whose
 * transaction boundary it owns (R3). Handlers are fetch-pure (R4): time via
 * `deps.clock`, crypto via WebCrypto, no `node:*`.
 *
 * Two entry modes (SEC-2), and since task 066 **two routes**, because the two have to
 * ride different mount decisions (Q21, SEC-14, ADR-09's amended Note):
 *
 * - **Anonymous** (`POST /sessions`, `{ formSlug }`): the form must exist, intake in this
 *   environment must be open, and a version must be **released to this environment** → a
 *   session pinned to that version, TTL from config. Mounted on `prod`'s surface alone,
 *   so there is no anonymous entry to a non-prod environment on any address.
 * - **Secure link** (`POST /sessions/link`, `{ token }`): the token verifies under
 *   `QCMS_LINK_KEYS`, the `secure_links` row must **name this environment** (Q21: the
 *   path names it, the row decides it) and must agree (not revoked; one-time links are
 *   consumed atomically - a signature alone is never sufficient), and intake in this
 *   environment must be open (the environment's closed state overrides every link into
 *   it, ADR-39 as amended by Q18) → a session pinned to the version released to this
 *   environment, expiring at `min(link expiry, session TTL)` so it never outlives the
 *   token (SEC-2).
 *
 * **The environment is the group's, never the request's** (Q21, Q2). `app.ts` mounts one
 * respondent group per environment and pins each with `fixedEnvironment`, so every read
 * and write below runs on that environment's pool and a respondent has nothing to send
 * that could change it.
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
// Type-only (erased at runtime, so no import cycle with route.ts): binds each
// handler to its route so `c.json(...)` yields the route's typed response.
import type { getSessionRoute, startLinkSessionRoute, startSessionRoute } from "./route.js";
import { environmentChallengeVerifier } from "../challenge.js";

// --- typed failures (envelope codes the portal keys off, 029) ---------------

const fail = {
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  formClosed: (): ApiError => new ApiError("FORM_CLOSED", 409, "This form is closed"),
  /**
   * The token is presented under the wrong prefix: its `secure_links` row names another
   * environment (Q21, criterion 2).
   *
   * **Refused, not redirected and not honoured.** A `404` rather than a `403` because
   * the honest answer is that there is no such link *here*: the address is one
   * environment's and the link is another's. It is also what the portal maps to the same
   * "this link is not valid" screen every other link failure reaches, so a respondent
   * learns nothing about which environment the token belongs to (Q16: the environment is
   * visible in the path and nowhere else).
   *
   * The composite foreign key would refuse the pair too (Q46, the thirteenth guard), and
   * that does not make this redundant: the guard makes the invariant structural and this
   * is what produces a legible refusal rather than a constraint violation.
   */
  linkWrongEnvironment: (): ApiError =>
    new ApiError("LINK_WRONG_ENVIRONMENT", 404, "This link is not valid here"),
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

/** The 201 body both entry routes return. */
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

/**
 * `POST /sessions` - **anonymous** entry, on `prod`'s respondent surface alone.
 *
 * No discriminator left: the body carries a form slug and nothing else, and which route
 * was called is which entry mode this is. 201 Created.
 */
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

/**
 * `POST /sessions/link` - **secure-link** entry, on every environment's respondent
 * surface. 201 Created.
 */
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

/** The challenge inputs threaded from the request: the client's solution + IP. */
interface ChallengeContext {
  readonly token: string | undefined;
  readonly ip: string | undefined;
}

/**
 * Enforce a form's `challengeRequired` setting (task 026) under **this environment's**
 * challenge provider (Q11, task 066).
 *
 * The provider is a per-environment value, read from `control.environments` rather than
 * from the process environment: a test environment that asks a tester to solve a visible
 * challenge is a cost with no benefit, and that is the whole of the setting. A `NULL`
 * column leaves the installation-wide typed value in force, which is the configuration
 * every deployment starts from.
 *
 * The row is read **only when a form actually requires a challenge**, so the ordinary
 * request pays nothing for a setting almost no form sets. When set, the verifier must
 * pass for the request's challenge token; a failure rejects start-session with 403. With
 * the effective provider `none` the null verifier accepts everything, so the setting
 * no-ops - the check still runs (structurally honoured) but never blocks.
 */
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
 * The environment's state for this form, or the refusal it implies (Q18, criterion 5).
 *
 * One read for two questions, and the order of the two refusals is deliberate. "Closed"
 * is checked before "nothing released", because an environment whose intake an operator
 * stopped should say so rather than reporting that the form was never published there.
 *
 * **Called before anything is spent** on both entry paths: no one-time link is consumed
 * and no challenge is charged for a closed environment, which is the property issue #724
 * bought for the whole-form state and that Q18 carries across rather than rebuilds.
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
  // The environment's state, not a whole-form status: `prod` may be closed while a
  // `test` run continues, and the reverse (Q18). This route only ever runs on `prod`,
  // and it reads the environment's state rather than assuming which one it is.
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
  request: RequestDatabase,
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

  const row = await getSecureLink(request.exec, linkId);
  // A validly-signed link with no server row was never minted here - reject it
  // as invalid rather than trusting the token alone (SEC-2).
  if (row === undefined) throw fail.linkInvalid();
  // **The prefix check** (Q21, criterion 2), first of the row's three gates and before
  // anything is spent. The environment is not in the token: the address named one, this
  // row names one, and they have to be the same. A token presented under the wrong
  // prefix is refused here - never redirected to the right prefix, which would turn a
  // leaked production link into a working one for anybody who found the test address,
  // and never honoured, which the composite foreign key would refuse one layer down
  // anyway (Q46).
  //
  // Ahead of `assertLinkUsable` on purpose: whether this link is revoked or spent is
  // not a question this environment has any business answering about another
  // environment's link.
  if (row.environment !== request.environment) throw fail.linkWrongEnvironment();
  assertLinkUsable(row, now);

  // The environment's closed state overrides every link into it, secure ones included
  // (ADR-39 as amended by Q18, issue #724). It is checked here, after the link's own
  // state and before anything is spent: a closed environment must not consume a one-time
  // link, charge a challenge, or create a session. The same read gives the version this
  // session will be pinned to.
  //
  // A form may also require a challenge even for invited (secure-link) entry;
  // the setting is per-form (task 026) and the provider is per environment (Q11).
  const released = await requireOpenEnvironment(request, formId);
  const form = await getForm(request.exec, formId);
  await enforceChallenge(deps, request, form?.challengeRequired ?? false, challenge);

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

  if (oneTime === true) {
    // One-time: consume + create in one transaction. The CAS in
    // `consumeSecureLink` makes exactly one of two concurrent starts win; the
    // loser matches no row → LINK_CONSUMED and the transaction rolls back so no
    // orphan session is created.
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
 * Insert a version-pinned secure-link session (ADR-40, I4).
 *
 * The version was resolved by {@link requireOpenEnvironment}, with the closed reading,
 * before anything was spent - so the one-time consumption and this insert share a
 * transaction without a read inside it that could refuse after the link was consumed.
 *
 * The environment is the connection's own, which is also the environment the link's row
 * names - this handler checked it and the composite foreign key refuses the pair
 * otherwise - so the release that was read is the release of the environment the session
 * is about to land in.
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
    // The connection's own environment (Q46). With a link, the composite foreign key
    // additionally requires the link's own row to name the same one, so a link minted
    // for another environment cannot start a session here however the request arrived.
    environment,
    expiresAt: session.expiresAt,
  });
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
        // Reserved for the forward-pass flow position; 019 (get-step) fills it.
        position: null,
      },
      200,
    );
  };
}
