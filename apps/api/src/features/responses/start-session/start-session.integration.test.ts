import {
  FormId,
  type LinkClaims,
  LinkId,
  SessionId,
  importCompactTokenKey,
  mintSecureLink,
} from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  closeFormInEnvironment,
  consumeSecureLink,
  createForm,
  getSecureLink,
  getSession,
  insertFormRelease,
  insertFormVersion,
  insertSecureLink,
  revokeSecureLink,
} from "@roonga/qcms-db";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  startTestDb,
  type TestDb,
  DEFAULT_TEST_ENVIRONMENT,
} from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import type { ChallengeVerifier } from "../challenge.js";
import { fixedClock, internalTokenFor, makeDeps, validEnv } from "../../../test-support.js";
import { registerAnonymousEntry, registerLinkEntry, registerSessionStatus } from "./route.js";

const NOW = new Date("2026-07-20T00:00:00.000Z");
const TTL_MS = 24 * 60 * 60 * 1000;
const PUBLIC_ONLY = {
  public: true,
  internal: false,
  admin: false,
  environments: [],
} as const;

// Types derived from the helper so apps/api needs no dependency on the compiler package.
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
  deps = makeDeps({
    db: testDb.db,
    clock: fixedClock(NOW),
    // The clock is fixed, so the default per-IP cap of 20 an hour is a hard budget for
    // the whole file and an extra case would make an unrelated test read 429.
    env: validEnv({ QCMS_RL_SESSION_CREATE_MAX: "200" }),
  });
  app = createApp(deps, PUBLIC_ONLY, {
    groups: {
      anonymous: [registerAnonymousEntry],
      respondent: [registerLinkEntry, registerSessionStatus],
    },
  });
  internalToken = internalTokenFor(deps.config);
  linkKey = await importCompactTokenKey(new TextEncoder().encode(deps.config.keys.link[0]));
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

// A body carrying `token` belongs to the secure-link route, one carrying `formSlug` to
// anonymous entry.
function entryPath(body: unknown): string {
  return typeof body === "object" && body !== null && "token" in body
    ? "/sessions/link"
    : "/sessions";
}

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(entryPath(body), {
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

// The release is part of the fixture because a published version is served nowhere until
// it is released, so publishing alone would describe a form no session can start on.
async function seedForm(
  id: string,
  slug: string,
  opts: {
    versions?: number;
    closed?: boolean;
    challengeRequired?: boolean;
    release?: boolean;
  } = {},
): Promise<FormId> {
  const formId = FormId.parse(id);
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId,
    slug,
    defaultLocale: "en",
    ...(opts.challengeRequired !== undefined ? { challengeRequired: opts.challengeRequired } : {}),
  });
  const versions = opts.versions ?? 0;
  for (let i = 0; i < versions; i++) {
    await insertFormVersion(testDb.db, {
      formId,
      definition: emptyDef,
      compiled: emptyCompiled,
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
    });
  }
  if (versions > 0 && opts.release !== false) {
    await release(formId, versions);
  }
  // Closing is only expressible once something is released there, so it follows the
  // release.
  if (opts.closed) {
    await closeFormInEnvironment(testDb.db, {
      formId,
      environment: DEFAULT_TEST_ENVIRONMENT,
      closedBy: "usr_fixture",
    });
  }
  return formId;
}

async function release(formId: FormId, version: number): Promise<void> {
  await insertFormRelease(testDb.db, {
    formId,
    environment: DEFAULT_TEST_ENVIRONMENT,
    version,
    releasedBy: "usr_fixture",
  });
}

async function sessionCount(formId: FormId): Promise<number> {
  const res = await testDb.client.query<{ n: string }>(
    `select count(*) as n from sessions where form_id = $1`,
    [formId],
  );
  return Number(res.rows[0]?.n ?? "0");
}

async function seedLink(
  formId: FormId,
  linkIdStr: string,
  opts: { oneTime?: boolean; expiresAt?: Date } = {},
): Promise<string> {
  const linkId = LinkId.parse(linkIdStr);
  const expiresAt = opts.expiresAt ?? new Date(NOW.getTime() + 60 * 60 * 1000);
  await insertSecureLink(testDb.db, {
    environment: DEFAULT_TEST_ENVIRONMENT,
    linkId,
    formId,
    expiresAt,
    oneTime: opts.oneTime ?? false,
  });
  const claims: LinkClaims = {
    formId,
    linkId,
    expiresAt: expiresAt.toISOString(),
    oneTime: opts.oneTime ?? false,
  };
  return mintSecureLink(claims, linkKey);
}

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
    await revokeSecureLink(
      testDb.db,
      LinkId.parse("lnk_revoked"),
      formId,
      DEFAULT_TEST_ENVIRONMENT,
      NOW,
    );
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

describe("secure-link start", () => {
  it("pins the link form's newest version, accessMode secure_link, expiry = link expiry (< TTL)", async () => {
    const formId = await seedForm("frm_link_ok", "link-ok", { versions: 2 });
    const linkExpiry = new Date(NOW.getTime() + 60 * 60 * 1000);
    const token = await seedLink(formId, "lnk_ok", { expiresAt: linkExpiry });
    const res = await post({ token });
    expect(res.status).toBe(201);
    const body = (await res.json()) as StartBody;
    expect(body.formVersion).toBe(2);
    expect(body.expiresAt).toBe(linkExpiry.toISOString());

    const row = await getSession(testDb.db, SessionId.parse(body.sessionId));
    expect(row?.accessMode).toBe("secure_link");
    expect(row?.linkId).toBe("lnk_ok");
  });

  it("clamps session expiry to the anonymous TTL when the link outlives it", async () => {
    const formId = await seedForm("frm_link_long", "link-long", { versions: 1 });
    const token = await seedLink(formId, "lnk_long", {
      expiresAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000),
    });
    const res = await post({ token });
    expect(res.status).toBe(201);
    const body = (await res.json()) as StartBody;
    expect(body.expiresAt).toBe(new Date(NOW.getTime() + TTL_MS).toISOString());
  });
});

describe("whole-form closed state binds secure links (ADR-39)", () => {
  it("FORM_CLOSED for a valid link into a closed form (409), and no session is created", async () => {
    const formId = await seedForm("frm_link_closed", "link-closed", {
      versions: 1,
      closed: true,
    });
    const token = await seedLink(formId, "lnk_closed");

    const res = await post({ token });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("FORM_CLOSED");
    expect(await sessionCount(formId)).toBe(0);
  });

  it("a one-time link into a closed form is refused without being consumed", async () => {
    const formId = await seedForm("frm_link_closed_once", "link-closed-once", {
      versions: 1,
      closed: true,
    });
    const token = await seedLink(formId, "lnk_closed_once", { oneTime: true });

    const res = await post({ token });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("FORM_CLOSED");
    const link = await getSecureLink(testDb.db, LinkId.parse("lnk_closed_once"));
    expect(link?.consumedAt).toBeNull();
    expect(await sessionCount(formId)).toBe(0);
  });

  it("the link's own state is settled first: a revoked link into a closed form reports LINK_REVOKED", async () => {
    const formId = await seedForm("frm_link_closed_rev", "link-closed-rev", {
      versions: 1,
      closed: true,
    });
    const token = await seedLink(formId, "lnk_closed_rev");
    await revokeSecureLink(
      testDb.db,
      LinkId.parse("lnk_closed_rev"),
      formId,
      DEFAULT_TEST_ENVIRONMENT,
      NOW,
    );

    const res = await post({ token });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrBody).error.code).toBe("LINK_REVOKED");
  });
});

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
    // Two steps so the two defects stay distinguishable: a missing row means the
    // winner's transaction never committed, a null `linkId` that it committed unbound.
    expect(
      row,
      `winner session ${winnerBody.sessionId} has no row: winner tx did not commit`,
    ).toBeDefined();
    expect(row?.linkId, "winner session row committed but is not bound to the link").toBe(
      "lnk_race",
    );

    // Every assertion above passes with `consumed_at` still null, because the loser's
    // 409 can come from the winner's own connection rather than from the row.
    const link = await getSecureLink(testDb.db, LinkId.parse("lnk_race"));
    expect(link?.consumedAt, "the winning start left the one-time link replayable").toEqual(NOW);
  });
});

describe("version pinning (exit criterion 2) and release resolution (exit criterion 4)", () => {
  it("a session keeps its pinned version after a later publish and its release (I4)", async () => {
    const formId = await seedForm("frm_pin", "pin-form", { versions: 1 });
    const start = await post({ formSlug: "pin-form" });
    const body = (await start.json()) as StartBody;
    expect(body.formVersion).toBe(1);

    // Publishing alone reaches no environment, so v2 changes nothing a respondent sees.
    await insertFormVersion(testDb.db, {
      formId,
      definition: emptyDef,
      compiled: emptyCompiled,
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
    });
    const unreleased = (await (await post({ formSlug: "pin-form" })).json()) as StartBody;
    expect(unreleased.formVersion).toBe(1);

    await release(formId, 2);

    const status = await get(body.sessionId, { authorization: `Bearer ${body.sessionToken}` });
    expect(status.status).toBe(200);
    const view = (await status.json()) as { formVersion: number; status: string; position: null };
    expect(view.formVersion).toBe(1);
    expect(view.status).toBe("created");
    expect(view.position).toBeNull();

    const later = (await (await post({ formSlug: "pin-form" })).json()) as StartBody;
    expect(later.formVersion).toBe(2);
  });

  it("serves the version released to this environment, not the newest published one", async () => {
    const formId = await seedForm("frm_three", "three-form", { versions: 3, release: false });
    await release(formId, 2);
    const body = (await (await post({ formSlug: "three-form" })).json()) as StartBody;
    expect(body.formVersion).toBe(2);
  });

  it("refuses a form with published versions and no release in this environment", async () => {
    await seedForm("frm_unreleased", "unreleased-form", { versions: 2, release: false });
    const res = await post({ formSlug: "unreleased-form" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrBody).error.code).toBe("NO_PUBLISHED_VERSION");
  });
});

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

describe("challenge seam for challengeRequired forms", () => {
  const testVerifier: ChallengeVerifier = {
    verify: (token) => Promise.resolve({ ok: token === "good-token" }),
  };

  function appWithVerifier(verifier: ChallengeVerifier): ReturnType<typeof createApp> {
    const d = makeDeps({
      db: testDb.db,
      clock: fixedClock(NOW),
      config: deps.config,
      challenge: verifier,
    });
    return createApp(d, PUBLIC_ONLY, {
      groups: {
        anonymous: [registerAnonymousEntry],
        respondent: [registerLinkEntry, registerSessionStatus],
      },
    });
  }

  async function postTo(targetApp: ReturnType<typeof createApp>, body: unknown): Promise<Response> {
    return targetApp.request(entryPath(body), {
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
    // The outer suite's `app` carries the default null verifier.
    const res = await post({ formSlug: "challenge-form" });
    expect(res.status).toBe(201);
  });

  it("does not challenge a form that does not require it", async () => {
    await seedForm("frm_nochallenge", "no-challenge-form", { versions: 1 });
    const gated = appWithVerifier(testVerifier);
    const res = await postTo(gated, { formSlug: "no-challenge-form" });
    expect(res.status).toBe(201);
  });

  it("rejects secure-link start without a challenge token for a challengeRequired form (403)", async () => {
    const formId = await seedForm("frm_challenge_link", "challenge-link-form", {
      versions: 1,
      challengeRequired: true,
    });
    const token = await seedLink(formId, "lnk_challenge");
    const gated = appWithVerifier(testVerifier);
    const res = await postTo(gated, { token });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrBody).error.code).toBe("CHALLENGE_REQUIRED");
  });

  it("admits secure-link start with a valid challenge token for a challengeRequired form (201)", async () => {
    const formId = await seedForm("frm_challenge_link_ok", "challenge-link-ok-form", {
      versions: 1,
      challengeRequired: true,
    });
    const token = await seedLink(formId, "lnk_challenge_ok");
    const gated = appWithVerifier(testVerifier);
    const res = await postTo(gated, { token, challengeToken: "good-token" });
    expect(res.status).toBe(201);
  });
});
