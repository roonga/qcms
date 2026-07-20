/**
 * Start-session slice tests (task 018), driven through `app.request()` against
 * the **real** kernel and the 013 Testcontainers harness DB — never a mock of
 * our own packages (CONTRIBUTING). Requires Docker.
 *
 * Covers every exit criterion: the anonymous happy path, each typed failure,
 * the one-time link race (exactly one of two concurrent starts wins), version
 * pinning across a later publish (I4), newest-version selection, and the
 * session-token gate (missing / tampered / cross-purpose → 401).
 */

import {
  FormId,
  type LinkClaims,
  LinkId,
  SessionId,
  importCompactTokenKey,
  mintSecureLink,
} from "@qcms/core";
import {
  closeForm,
  consumeSecureLink,
  createForm,
  getSession,
  insertFormVersion,
  insertSecureLink,
  revokeSecureLink,
} from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import type { ChallengeVerifier } from "../challenge.js";
import { fixedClock, internalTokenFor, makeDeps, validEnv } from "../../../test-support.js";
import { registerStartSession } from "./route.js";

const BOOT_TIMEOUT = 120_000;
const NOW = new Date("2026-07-20T00:00:00.000Z");
const TTL_MS = 24 * 60 * 60 * 1000;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;

// Opaque domain JSONB — Postgres does not interpret it; tests store empties.
// Types derived from the helper so apps/api needn't depend on @qcms/a2ui-compiler.
type VersionInput = Parameters<typeof insertFormVersion>[1];
const emptyDef = {} as unknown as VersionInput["definition"];
const emptyCompiled = {} as unknown as VersionInput["compiled"];

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let linkKey: CryptoKey;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, clock: fixedClock(NOW), env: validEnv() });
  app = createApp(deps, PUBLIC_ONLY, { groups: { public: [registerStartSession] } });
  internalToken = internalTokenFor(deps.config);
  linkKey = await importCompactTokenKey(new TextEncoder().encode(deps.config.keys.link[0]));
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
}, BOOT_TIMEOUT);

// --- request helpers --------------------------------------------------------

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request("/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": internalToken,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function get(id: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(`/sessions/${id}`, {
    headers: { "x-qcms-internal-token": internalToken, ...headers },
  });
}

interface StartBody {
  sessionId: string;
  sessionToken: string;
  formVersion: number;
  expiresAt: string;
}
interface ErrBody {
  error: { code: string; message: string };
}

// --- seed helpers -----------------------------------------------------------

/** Seed a form with `versions` published versions (v1..vN). Returns the FormId. */
async function seedForm(
  id: string,
  slug: string,
  opts: { versions?: number; closed?: boolean; challengeRequired?: boolean } = {},
): Promise<FormId> {
  const formId = FormId.parse(id);
  await createForm(testDb.db, {
    formId,
    slug,
    defaultLocale: "en",
    ...(opts.challengeRequired !== undefined ? { challengeRequired: opts.challengeRequired } : {}),
  });
  for (let i = 0; i < (opts.versions ?? 0); i++) {
    await insertFormVersion(testDb.db, {
      formId,
      definition: emptyDef,
      compiled: emptyCompiled,
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
    });
  }
  if (opts.closed) await closeForm(testDb.db, formId);
  return formId;
}

/** Insert a secure_links row and mint the matching signed token. */
async function seedLink(
  formId: FormId,
  linkIdStr: string,
  opts: { oneTime?: boolean; expiresAt?: Date } = {},
): Promise<string> {
  const linkId = LinkId.parse(linkIdStr);
  const expiresAt = opts.expiresAt ?? new Date(NOW.getTime() + 60 * 60 * 1000); // +1h
  await insertSecureLink(testDb.db, { linkId, formId, expiresAt, oneTime: opts.oneTime ?? false });
  const claims: LinkClaims = {
    formId,
    linkId,
    expiresAt: expiresAt.toISOString(),
    oneTime: opts.oneTime ?? false,
  };
  return mintSecureLink(claims, linkKey);
}

// --- exit criterion 1: anonymous happy path ---------------------------------

describe("anonymous start (exit criterion 1)", () => {
  it("creates a session pinned to the newest published version with a session token", async () => {
    await seedForm("frm_anon_ok", "anon-ok", { versions: 1 });
    const res = await post({ formSlug: "anon-ok" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as StartBody;

    expect(body.sessionId).toMatch(/^ses_[a-z0-9]+$/);
    expect(body.formVersion).toBe(1);
    expect(body.sessionToken.length).toBeGreaterThan(0);
    expect(body.expiresAt).toBe(new Date(NOW.getTime() + TTL_MS).toISOString());

    const row = await getSession(testDb.db, SessionId.parse(body.sessionId));
    expect(row?.accessMode).toBe("anonymous");
    expect(row?.status).toBe("created");
    expect(row?.formVersion).toBe(1);
  });
});

// --- exit criterion 1: typed failures ---------------------------------------

describe("typed failures (exit criterion 1)", () => {
  it("FORM_NOT_FOUND for an unknown slug (404)", async () => {
    const res = await post({ formSlug: "does-not-exist" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrBody).error.code).toBe("FORM_NOT_FOUND");
  });

  it("FORM_CLOSED for a closed form (409)", async () => {
    await seedForm("frm_closed", "closed-form", { versions: 1, closed: true });
    const res = await post({ formSlug: "closed-form" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("FORM_CLOSED");
  });

  it("NO_PUBLISHED_VERSION for an open form with no version (409)", async () => {
    await seedForm("frm_noversion", "no-version", { versions: 0 });
    const res = await post({ formSlug: "no-version" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("NO_PUBLISHED_VERSION");
  });

  it("LINK_INVALID for a malformed/forged token (400)", async () => {
    const res = await post({ token: "not-a-valid-token" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrBody).error.code).toBe("LINK_INVALID");
  });

  it("LINK_EXPIRED for a token past its expiry (403)", async () => {
    const formId = await seedForm("frm_linkexp", "link-exp", { versions: 1 });
    const token = await seedLink(formId, "lnk_expired", {
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    const res = await post({ token });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrBody).error.code).toBe("LINK_EXPIRED");
  });

  it("LINK_REVOKED for a revoked link (403)", async () => {
    const formId = await seedForm("frm_linkrev", "link-rev", { versions: 1 });
    const token = await seedLink(formId, "lnk_revoked");
    await revokeSecureLink(testDb.db, LinkId.parse("lnk_revoked"), NOW);
    const res = await post({ token });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrBody).error.code).toBe("LINK_REVOKED");
  });

  it("LINK_CONSUMED for an already-consumed one-time link (409)", async () => {
    const formId = await seedForm("frm_linkused", "link-used", { versions: 1 });
    const token = await seedLink(formId, "lnk_used", { oneTime: true });
    await consumeSecureLink(testDb.db, LinkId.parse("lnk_used"), NOW);
    const res = await post({ token });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("LINK_CONSUMED");
  });
});

// --- secure-link happy paths + min-expiry -----------------------------------

describe("secure-link start", () => {
  it("pins the link form's newest version, accessMode secure_link, expiry = link expiry (< TTL)", async () => {
    const formId = await seedForm("frm_link_ok", "link-ok", { versions: 2 });
    const linkExpiry = new Date(NOW.getTime() + 60 * 60 * 1000); // +1h < 24h TTL
    const token = await seedLink(formId, "lnk_ok", { expiresAt: linkExpiry });
    const res = await post({ token });
    expect(res.status).toBe(201);
    const body = (await res.json()) as StartBody;
    expect(body.formVersion).toBe(2);
    expect(body.expiresAt).toBe(linkExpiry.toISOString()); // min(link, TTL) = link

    const row = await getSession(testDb.db, SessionId.parse(body.sessionId));
    expect(row?.accessMode).toBe("secure_link");
    expect(row?.linkId).toBe("lnk_ok");
  });

  it("clamps session expiry to the anonymous TTL when the link outlives it", async () => {
    const formId = await seedForm("frm_link_long", "link-long", { versions: 1 });
    const token = await seedLink(formId, "lnk_long", {
      expiresAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000), // +48h > 24h TTL
    });
    const res = await post({ token });
    expect(res.status).toBe(201);
    const body = (await res.json()) as StartBody;
    expect(body.expiresAt).toBe(new Date(NOW.getTime() + TTL_MS).toISOString()); // TTL ceiling
  });
});

// --- exit criterion 1: one-time link race -----------------------------------

describe("one-time link race (exit criterion 1)", () => {
  it("two concurrent starts on one one-time link: exactly one wins", async () => {
    const formId = await seedForm("frm_race", "race-form", { versions: 1 });
    const token = await seedLink(formId, "lnk_race", { oneTime: true });

    const [a, b] = await Promise.all([post({ token }), post({ token })]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = a.status === 201 ? a : b;
    const loser = a.status === 201 ? b : a;
    expect(((await loser.json()) as ErrBody).error.code).toBe("LINK_CONSUMED");
    const winnerBody = (await winner.json()) as StartBody;
    const row = await getSession(testDb.db, SessionId.parse(winnerBody.sessionId));
    expect(row?.linkId).toBe("lnk_race");
  });
});

// --- exit criterion 2: pinning + exit criterion 4: newest-version -----------

describe("version pinning (exit criterion 2) and newest-version selection (exit criterion 4)", () => {
  it("a session keeps its pinned version after a later publish (I4)", async () => {
    const formId = await seedForm("frm_pin", "pin-form", { versions: 1 });
    const start = await post({ formSlug: "pin-form" });
    const body = (await start.json()) as StartBody;
    expect(body.formVersion).toBe(1);

    // Publish v2 AFTER the session was created.
    await insertFormVersion(testDb.db, {
      formId,
      definition: emptyDef,
      compiled: emptyCompiled,
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
    });

    const status = await get(body.sessionId, { authorization: `Bearer ${body.sessionToken}` });
    expect(status.status).toBe(200);
    const view = (await status.json()) as { formVersion: number; status: string; position: null };
    expect(view.formVersion).toBe(1); // still v1 — never migrates
    expect(view.status).toBe("created");
    expect(view.position).toBeNull();

    // A new session now binds to v2 (newest).
    const later = (await (await post({ formSlug: "pin-form" })).json()) as StartBody;
    expect(later.formVersion).toBe(2);
  });

  it("selects the newest of three published versions", async () => {
    await seedForm("frm_three", "three-form", { versions: 3 });
    const body = (await (await post({ formSlug: "three-form" })).json()) as StartBody;
    expect(body.formVersion).toBe(3);
  });
});

// --- exit criterion 3: session-token gate -----------------------------------

describe("session-token gate (exit criterion 3, SEC-2)", () => {
  let sessionId: string;
  let sessionToken: string;

  beforeAll(async () => {
    await seedForm("frm_gate", "gate-form", { versions: 1 });
    const body = (await (await post({ formSlug: "gate-form" })).json()) as StartBody;
    sessionId = body.sessionId;
    sessionToken = body.sessionToken;
  });

  it("GET without a session token → 401", async () => {
    const res = await get(sessionId);
    expect(res.status).toBe(401);
  });

  it("GET with a tampered token → 401", async () => {
    const tampered = sessionToken.slice(0, -3) + (sessionToken.endsWith("aaa") ? "bbb" : "aaa");
    const res = await get(sessionId, { authorization: `Bearer ${tampered}` });
    expect(res.status).toBe(401);
  });

  it("GET with a valid token but mismatched path id → 401 (no cross-session read)", async () => {
    const res = await get("ses_someoneelse", { authorization: `Bearer ${sessionToken}` });
    expect(res.status).toBe(401);
  });

  it("a link-purpose token is rejected as a session token → 401 (cross-purpose, SEC-7)", async () => {
    const formId = FormId.parse("frm_gate");
    const linkToken = await seedLink(formId, "lnk_forgate");
    const res = await get(sessionId, { authorization: `Bearer ${linkToken}` });
    expect(res.status).toBe(401);
  });

  it("GET with the correct token → 200", async () => {
    const res = await get(sessionId, { authorization: `Bearer ${sessionToken}` });
    expect(res.status).toBe(200);
  });
});

// --- challenge adapter seam (task 026, exit criterion 4) --------------------

describe("challenge seam for challengeRequired forms", () => {
  // A test verifier standing in for a real provider (Turnstile is 029): only the
  // exact solution "good-token" passes; a missing/other token fails.
  const testVerifier: ChallengeVerifier = {
    verify: (token) => Promise.resolve({ ok: token === "good-token" }),
  };

  /** A second app whose deps carry the test verifier (same DB, same signing keys). */
  function appWithVerifier(verifier: ChallengeVerifier): ReturnType<typeof createApp> {
    const d = makeDeps({
      db: testDb.db,
      clock: fixedClock(NOW),
      config: deps.config,
      challenge: verifier,
    });
    return createApp(d, PUBLIC_ONLY, { groups: { public: [registerStartSession] } });
  }

  async function postTo(targetApp: ReturnType<typeof createApp>, body: unknown): Promise<Response> {
    return targetApp.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-qcms-internal-token": internalToken },
      body: JSON.stringify(body),
    });
  }

  it("rejects start-session without a challenge token for a challengeRequired form (403)", async () => {
    await seedForm("frm_challenge", "challenge-form", { versions: 1, challengeRequired: true });
    const gated = appWithVerifier(testVerifier);
    const res = await postTo(gated, { formSlug: "challenge-form" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrBody).error.code).toBe("CHALLENGE_REQUIRED");
  });

  it("rejects an invalid challenge token (403)", async () => {
    const gated = appWithVerifier(testVerifier);
    const res = await postTo(gated, { formSlug: "challenge-form", challengeToken: "nope" });
    expect(res.status).toBe(403);
  });

  it("admits a valid challenge token (201)", async () => {
    const gated = appWithVerifier(testVerifier);
    const res = await postTo(gated, { formSlug: "challenge-form", challengeToken: "good-token" });
    expect(res.status).toBe(201);
  });

  it("the null verifier (provider none) no-ops: challengeRequired form admits with no token (201)", async () => {
    // `deps`/`app` from the outer suite use the default null verifier.
    const res = await post({ formSlug: "challenge-form" });
    expect(res.status).toBe(201);
  });

  it("does not challenge a form that does not require it", async () => {
    await seedForm("frm_nochallenge", "no-challenge-form", { versions: 1 });
    const gated = appWithVerifier(testVerifier);
    const res = await postTo(gated, { formSlug: "no-challenge-form" });
    expect(res.status).toBe(201);
  });
});
