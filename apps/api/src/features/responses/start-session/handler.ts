/**
 * Start-session handlers (task 018) — the respondent's front door.
 *
 * This is a **transaction script** (R5): the only kernel calls are token
 * verify/mint (`verifySecureLink`, `mintSessionToken`); everything else is
 * shape-preserving `@qcms/db` reads/writes the slice sequences and whose
 * transaction boundary it owns (R3). Handlers are fetch-pure (R4): time via
 * `deps.clock`, crypto via WebCrypto, no `node:*`.
 *
 * Two entry modes (SEC-2):
 *
 * - **Anonymous** (`{ formSlug }`): the form must exist, be `open`, and have at
 *   least one published version → a session pinned to the *newest* published
 *   version, TTL from config.
 * - **Secure link** (`{ token }`): the token verifies under `QCMS_LINK_KEYS`,
 *   the `secure_links` row must agree (not revoked; one-time links are consumed
 *   atomically — a signature alone is never sufficient) → a session pinned to
 *   the *link's* form's newest published version, expiring at
 *   `min(link expiry, session TTL)` so it never outlives the token (SEC-2).
 *
 * Every pinning insert goes through `createSession`, whose `(formId,
 * formVersion)` write is the sole path that sets a session's version — that
 * absence of a re-pin path is how I4 (a session never migrates versions) holds.
 */

import type { RouteHandler } from "@hono/zod-openapi";
import { importCompactTokenKey, verifySecureLink } from "@qcms/core";
import type { FormId, LinkId, SessionId } from "@qcms/core";
import {
  consumeSecureLink,
  createSession,
  getFormBySlug,
  getLatestPublishedVersion,
  getSecureLink,
  getSession,
} from "@qcms/db";
import type { Executor, SecureLinkRow } from "@qcms/db";

import type { Config } from "../../../config.js";
import type { Deps } from "../../../deps.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import { authenticateSession, importSessionKeys, mintSessionToken } from "../session-token.js";
// Type-only (erased at runtime, so no import cycle with route.ts): binds each
// handler to its route so `c.json(...)` yields the route's typed response.
import type { getSessionRoute, startSessionRoute } from "./route.js";

// --- typed failures (envelope codes the portal keys off, 029) ---------------

const fail = {
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  formClosed: (): ApiError => new ApiError("FORM_CLOSED", 409, "This form is closed"),
  noPublishedVersion: (): ApiError =>
    new ApiError("NO_PUBLISHED_VERSION", 409, "This form has no published version"),
  linkInvalid: (): ApiError => new ApiError("LINK_INVALID", 400, "This link is not valid"),
  linkExpired: (): ApiError => new ApiError("LINK_EXPIRED", 403, "This link has expired"),
  linkConsumed: (): ApiError =>
    new ApiError("LINK_CONSUMED", 409, "This link has already been used"),
  linkRevoked: (): ApiError => new ApiError("LINK_REVOKED", 403, "This link has been revoked"),
} as const;

/** A fresh, branded session id: `ses_` + 16 random hex bytes (matches `^ses_[a-z0-9_]+$`). */
function newSessionId(): SessionId {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `ses_${hex}` as SessionId;
}

/** Anonymous session TTL expiry: `now + config TTL`. */
function anonymousExpiry(config: Config, now: Date): Date {
  return new Date(now.getTime() + config.ttl.anonymousSessionMs);
}

interface StartResult {
  sessionId: SessionId;
  sessionToken: string;
  formVersion: number;
  expiresAt: Date;
}

// @qcms/db's row types for its enum-bearing tables (`forms`, `sessions`) resolve
// to a TypeScript *error* type when consumed through the package's emitted
// `.d.ts` — a drizzle `$inferSelect` + `PgEnumColumn` interaction that
// `skipLibCheck` hides from `tsc` but typed-lint surfaces as unsafe. (The
// enum-free rows — `form_versions`, `secure_links` — are unaffected.) Reading
// them through a narrow local view of the fields this slice uses keeps the code
// fully typed; a follow-up should give @qcms/db explicit row interfaces so every
// responses slice (019, 020, …) doesn't repeat this.
interface FormView {
  readonly formId: FormId;
  readonly status: "open" | "closed";
}
interface SessionView {
  readonly sessionId: SessionId;
  readonly status: "created" | "in_progress" | "submitted" | "expired";
  readonly formVersion: number;
  readonly expiresAt: Date;
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

    const result =
      body.token !== undefined
        ? await startFromSecureLink(deps, body.token, now)
        : await startAnonymous(deps, body.formSlug ?? "", now);

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

async function startAnonymous(deps: Deps, formSlug: string, now: Date): Promise<StartResult> {
  const form = (await getFormBySlug(deps.db, formSlug)) as FormView | undefined;
  if (form === undefined) throw fail.formNotFound();
  if (form.status === "closed") throw fail.formClosed();

  const version = await getLatestPublishedVersion(deps.db, form.formId);
  if (version === undefined) throw fail.noPublishedVersion();

  const expiresAt = anonymousExpiry(deps.config, now);
  const sessionId = newSessionId();
  await createSession(deps.db, {
    sessionId,
    formId: form.formId,
    formVersion: version.version,
    accessMode: "anonymous",
    expiresAt,
  });

  return finish(deps, sessionId, version.version, expiresAt);
}

async function startFromSecureLink(deps: Deps, token: string, now: Date): Promise<StartResult> {
  const keys = await importLinkKeys(deps.config);
  const verified = await verifySecureLink(token, keys, now);
  if (!verified.ok) {
    // MALFORMED / BAD_SIGNATURE / WRONG_PURPOSE / WRONG_FORM → invalid;
    // EXPIRED → expired. The signature is checked before any claim is trusted.
    throw verified.error.code === "EXPIRED" ? fail.linkExpired() : fail.linkInvalid();
  }
  const { formId, linkId, expiresAt: linkExpiresAtIso, oneTime } = verified.value;
  const linkExpiresAt = new Date(linkExpiresAtIso);

  const row = await getSecureLink(deps.db, linkId);
  // A validly-signed link with no server row was never minted here — reject it
  // as invalid rather than trusting the token alone (SEC-2).
  if (row === undefined) throw fail.linkInvalid();
  assertLinkUsable(row, now);

  // Session expiry never outlives the link, nor the anonymous TTL ceiling.
  const expiresAt = new Date(
    Math.min(linkExpiresAt.getTime(), anonymousExpiry(deps.config, now).getTime()),
  );
  const sessionId = newSessionId();

  let formVersion: number;
  if (oneTime === true) {
    // One-time: consume + create in one transaction. The CAS in
    // `consumeSecureLink` makes exactly one of two concurrent starts win; the
    // loser matches no row → LINK_CONSUMED and the transaction rolls back so no
    // orphan session is created.
    formVersion = await deps.db.transaction(async (tx) => {
      const consumed = await consumeSecureLink(tx, linkId, now);
      if (consumed === undefined) throw fail.linkConsumed();
      return insertPinnedSession(tx, sessionId, formId, linkId, expiresAt);
    });
  } else {
    formVersion = await insertPinnedSession(deps.db, sessionId, formId, linkId, expiresAt);
  }

  return finish(deps, sessionId, formVersion, expiresAt);
}

/**
 * Reject a secure link whose server-side state forbids use: revoked, already
 * consumed (one-time replay), or past its stored expiry. Signature validity is
 * never enough on its own (SEC-2).
 */
function assertLinkUsable(row: SecureLinkRow, now: Date): void {
  if (row.revokedAt !== null) throw fail.linkRevoked();
  if (row.consumedAt !== null) throw fail.linkConsumed();
  if (row.expiresAt.getTime() <= now.getTime()) throw fail.linkExpired();
}

/**
 * Insert a version-pinned secure-link session, resolving the newest published
 * version first (I4). Returns the pinned version number.
 */
async function insertPinnedSession(
  exec: Executor,
  sessionId: SessionId,
  formId: FormId,
  linkId: LinkId,
  expiresAt: Date,
): Promise<number> {
  const version = await getLatestPublishedVersion(exec, formId);
  if (version === undefined) throw fail.noPublishedVersion();
  await createSession(exec, {
    sessionId,
    formId,
    formVersion: version.version,
    accessMode: "secure_link",
    linkId,
    expiresAt,
  });
  return version.version;
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
 * `GET /sessions/{id}` — the resume/status view. Session-token authed: the
 * bearer token must verify (`purpose: "session"`) *and* bind the `id` in the
 * path (possession of an id alone grants nothing, SEC-2 §3).
 */
export function makeGetSessionHandler(deps: Deps): RouteHandler<typeof getSessionRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const authedSessionId = await authenticateSession(c, deps);
    if (authedSessionId !== id) {
      // Token is valid but for a different session — no cross-session read.
      throw new ApiError("unauthorized", 401, "Session token does not match this session");
    }

    const session = (await getSession(deps.db, authedSessionId)) as SessionView | undefined;
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
