import { FormId, importCompactTokenKey, verifySecureLink } from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  createForm,
  insertFormRelease,
  insertFormVersion,
} from "@roonga/qcms-db";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  DEFAULT_TEST_ENVIRONMENT,
  startTestDb,
  type TestDb,
} from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import {
  fixedClock,
  internalTokenFor,
  makeDeps,
  seedAdminSession,
  synthSecret,
  validEnv,
} from "../../test-support.js";
import { registerRequestEnvironment } from "../../middleware/request-environment.js";
import { registerLinkEntry } from "../responses/start-session/route.js";
import { MAX_LINK_BATCH } from "./schema.js";
import { registerLinks } from "./route.js";

const NOW = new Date("2026-07-20T00:00:00.000Z");
const FUTURE = "2026-12-31T23:59:59.000Z";
const ALL = { public: true, internal: false, admin: true } as const;

type VersionInput = Parameters<typeof insertFormVersion>[1];
const emptyDef = {} as unknown as VersionInput["definition"];
const emptyCompiled = {} as unknown as VersionInput["compiled"];

const FORM_ID = FormId.parse("frm_links_it");
const OTHER_FORM_ID = FormId.parse("frm_links_it_other");
let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let adminSessionToken: string;
let linkKeyA: string;
let baseEnv: Record<string, string | undefined>;

function buildApp(
  linkKeys: string,
  at: Date = NOW,
): { deps: Deps; app: ReturnType<typeof createApp> } {
  const d = makeDeps({
    db: testDb.db,
    clock: fixedClock(at),
    env: { ...baseEnv, QCMS_LINK_KEYS: linkKeys },
  });
  const a = createApp(d, ALL, {
    groups: {
      respondent: [registerLinkEntry],
      admin: [registerAdminAuth, registerRequestEnvironment, registerGrantCheck, registerLinks],
    },
  });
  return { deps: d, app: a };
}

beforeAll(async () => {
  testDb = await startTestDb();
  linkKeyA = synthSecret();
  baseEnv = validEnv({ QCMS_LINK_KEYS: linkKeyA });
  ({ deps, app } = buildApp(linkKeyA));
  internalToken = internalTokenFor(deps.config);
  adminSessionToken = (await seedAdminSession(testDb.db)).token;

  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FORM_ID,
    slug: "links-it",
    defaultLocale: "en",
  });
  const version = await insertFormVersion(testDb.db, {
    formId: FORM_ID,
    definition: emptyDef,
    compiled: emptyCompiled,
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  });
  // Redeeming a link resolves what is released to the session's environment, so the
  // fixture must release the version it publishes.
  await insertFormRelease(testDb.db, {
    formId: FORM_ID,
    environment: DEFAULT_TEST_ENVIRONMENT,
    version: version.version,
    releasedBy: "usr_fixture",
  });

  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: OTHER_FORM_ID,
    slug: "links-it-other",
    defaultLocale: "en",
  });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

function adminHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: adminSessionToken,
  };
}

async function mint(
  targetApp: ReturnType<typeof createApp>,
  body: Record<string, unknown>,
): Promise<Response> {
  return targetApp.request(`/admin/forms/${FORM_ID}/links`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ environment: DEFAULT_TEST_ENVIRONMENT, ...body }),
  });
}

async function revoke(formId: string, linkId: string): Promise<Response> {
  return app.request(`/admin/forms/${formId}/links/${linkId}/revoke`, {
    method: "POST",
    headers: adminHeaders(),
  });
}

async function startFromToken(
  targetApp: ReturnType<typeof createApp>,
  token: string,
): Promise<Response> {
  return targetApp.request("/sessions/link", {
    method: "POST",
    headers: { "content-type": "application/json", "x-qcms-internal-token": internalToken },
    body: JSON.stringify({ token }),
  });
}

async function listStates(
  targetApp: ReturnType<typeof createApp>,
): Promise<Record<string, string>> {
  const res = await targetApp.request(`/admin/forms/${FORM_ID}/links`, {
    headers: adminHeaders(),
  });
  expect(res.status).toBe(200);
  const { links } = (await res.json()) as { links: Array<{ linkId: string; state: string }> };
  return Object.fromEntries(links.map((link) => [link.linkId, link.state]));
}

function tokenFromUrl(url: string): string {
  const marker = "/l/";
  return url.slice(url.indexOf(marker) + marker.length);
}

describe("secure-link minting → 018 verification loop (exit criterion 1)", () => {
  it("mints a link whose token starts a session pinned to the form", async () => {
    const res = await mint(app, { expiresAt: FUTURE, oneTime: false });
    expect(res.status).toBe(201);
    const { links } = (await res.json()) as {
      links: Array<{ linkId: string; url: string; expiresAt: string }>;
    };
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.url.startsWith("https://forms.example.test/l/")).toBe(true);

    const token = tokenFromUrl(link.url);
    const keys = await Promise.all(
      deps.config.keys.link.map((k) => importCompactTokenKey(new TextEncoder().encode(k))),
    );
    const verified = await verifySecureLink(token, keys, NOW, FORM_ID);
    expect(verified.ok).toBe(true);

    const started = await startFromToken(app, token);
    expect(started.status).toBe(201);
    const session = (await started.json()) as { sessionId: string; formVersion: number };
    expect(session.sessionId.startsWith("ses_")).toBe(true);
    expect(session.formVersion).toBe(1);
  });

  it("rejects a revoked link at start-session", async () => {
    const res = await mint(app, { expiresAt: FUTURE, oneTime: false });
    const { links } = (await res.json()) as { links: Array<{ linkId: string; url: string }> };
    const { linkId, url } = links[0]!;
    const token = tokenFromUrl(url);

    const revoked = await revoke(FORM_ID, linkId);
    expect(revoked.status).toBe(200);
    expect((await revoked.json()) as { state: string }).toMatchObject({ state: "revoked" });

    const started = await startFromToken(app, token);
    expect(started.status).toBe(403);
    expect((await started.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "LINK_REVOKED" },
    });

    const again = await revoke(FORM_ID, linkId);
    expect(again.status).toBe(404);
  });

  it("refuses to revoke a link through another form's route (#478)", async () => {
    const res = await mint(app, { expiresAt: FUTURE, oneTime: false });
    const { links } = (await res.json()) as { links: Array<{ linkId: string }> };
    const linkId = links[0]!.linkId;

    const listed = await app.request(`/admin/forms/${FORM_ID}/links`, { headers: adminHeaders() });
    const listing = (await listed.json()) as {
      links: Array<{ linkId: string; state: string; revokedAt: string | null }>;
    };
    const before = listing.links.find((l) => l.linkId === linkId);
    expect(before).toMatchObject({ state: "active", revokedAt: null });

    const cross = await revoke(OTHER_FORM_ID, linkId);
    expect(cross.status).toBe(404);
    expect((await cross.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "LINK_NOT_FOUND" },
    });

    const after = await app.request(`/admin/forms/${FORM_ID}/links`, { headers: adminHeaders() });
    const afterListing = (await after.json()) as {
      links: Array<{ linkId: string; revokedAt: string | null }>;
    };
    expect(afterListing.links.find((l) => l.linkId === linkId)?.revokedAt).toBeNull();

    expect((await revoke(FORM_ID, linkId)).status).toBe(200);
  });

  it("mints a batch and rejects a count over the documented cap", async () => {
    const res = await mint(app, { expiresAt: FUTURE, oneTime: true, count: 5 });
    expect(res.status).toBe(201);
    const { links } = (await res.json()) as { links: unknown[] };
    expect(links).toHaveLength(5);

    const over = await mint(app, { expiresAt: FUTURE, count: MAX_LINK_BATCH + 1 });
    expect(over.status).toBe(400);
  });

  it("rejects a non-future expiry", async () => {
    const res = await mint(app, { expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(res.status).toBe(400);
  });

  it("lists links with derived state and consumption stamps", async () => {
    const res = await app.request(`/admin/forms/${FORM_ID}/links`, { headers: adminHeaders() });
    expect(res.status).toBe(200);
    const { links } = (await res.json()) as {
      links: Array<{ state: string; revokedAt: string | null }>;
    };
    expect(links.some((l) => l.state === "revoked" && l.revokedAt !== null)).toBe(true);
    expect(links.every((l) => ["active", "consumed", "expired", "revoked"].includes(l.state))).toBe(
      true,
    );
  });

  it("derives all four display states, including the two no browser fixture reaches", async () => {
    // A minute's expiry rather than `FUTURE`: the later-clock app below also checks the
    // seeded admin session against that clock, so a large gap would 401 every request.
    const soon = new Date(NOW.getTime() + 60_000).toISOString();
    const minted = await mint(app, { expiresAt: soon, oneTime: true, count: 3 });
    expect(minted.status).toBe(201);
    const { links: fresh } = (await minted.json()) as {
      links: Array<{ linkId: string; url: string }>;
    };
    expect(fresh).toHaveLength(3);
    const stillOpen = fresh[0]!;
    const spent = fresh[1]!;
    const closed = fresh[2]!;

    const started = await startFromToken(app, tokenFromUrl(spent.url));
    expect(started.status).toBe(201);

    expect((await revoke(FORM_ID, closed.linkId)).status).toBe(200);

    const now = await listStates(app);
    expect(now[stillOpen.linkId]).toBe("active");
    expect(now[spent.linkId]).toBe("consumed");
    expect(now[closed.linkId]).toBe("revoked");

    const afterExpiry = new Date(Date.parse(soon) + 1000);
    const { app: later } = buildApp(linkKeyA, afterExpiry);
    const then = await listStates(later);
    expect(then[stillOpen.linkId]).toBe("expired");
    expect(then[spent.linkId]).toBe("consumed");
    expect(then[closed.linkId]).toBe("revoked");

    expect(new Set([...Object.values(now), ...Object.values(then)])).toEqual(
      new Set(["active", "consumed", "expired", "revoked"]),
    );
  });

  it("requires admin auth (401 without a session marker)", async () => {
    const res = await app.request(`/admin/forms/${FORM_ID}/links`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-qcms-internal-token": internalToken },
      body: JSON.stringify({ expiresAt: FUTURE }),
    });
    expect(res.status).toBe(401);
  });
});

describe("key rotation: old-key links still verify after prepending a new key (exit criterion 2)", () => {
  it("a link minted under the old key verifies on an app whose key list prepends a new key", async () => {
    const res = await mint(app, { expiresAt: FUTURE, oneTime: false });
    const { links } = (await res.json()) as { links: Array<{ linkId: string; url: string }> };
    const token = tokenFromUrl(links[0]!.url);

    const linkKeyB = synthSecret();
    const rotated = buildApp(`${linkKeyB} ${linkKeyA}`);

    const started = await startFromToken(rotated.app, token);
    expect(started.status).toBe(201);

    const freshRes = await mint(rotated.app, { expiresAt: FUTURE });
    const fresh = (await freshRes.json()) as { links: Array<{ url: string }> };
    const freshStarted = await startFromToken(rotated.app, tokenFromUrl(fresh.links[0]!.url));
    expect(freshStarted.status).toBe(201);
  });
});
