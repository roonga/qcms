/**
 * Secure-link admin slice tests (task 024), driven through `app.request()`
 * against the real kernel and the 013 Testcontainers harness DB. Requires
 * Docker.
 *
 * Covers every exit criterion touching links:
 *  1. Mint → verify loop: a minted URL's token passes 018's start-session and
 *     creates a session pinned to the link's form; a revoked link is rejected;
 *     batch mint respects the documented cap.
 *  2. Rotation: a link minted under the old key still verifies after a new key
 *     is prepended to `QCMS_LINK_KEYS` (newest signs, all verify - 010).
 */

import { FormId, importCompactTokenKey, verifySecureLink } from "@qcms/core";
import { createForm, insertFormVersion } from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import {
  fixedClock,
  internalTokenFor,
  makeDeps,
  synthSecret,
  validEnv,
} from "../../test-support.js";
import { registerStartSession } from "../responses/start-session/route.js";
import { MAX_LINK_BATCH } from "./schema.js";
import { registerLinks } from "./route.js";

const BOOT_TIMEOUT = 120_000;
const NOW = new Date("2026-07-20T00:00:00.000Z");
const FUTURE = "2026-12-31T23:59:59.000Z";
const ALL = { public: true, internal: false, admin: true } as const;

type VersionInput = Parameters<typeof insertFormVersion>[1];
const emptyDef = {} as unknown as VersionInput["definition"];
const emptyCompiled = {} as unknown as VersionInput["compiled"];

const FORM_ID = FormId.parse("frm_links_it");
let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let linkKeyA: string;
// A fixed base env so every rebuilt app (rotation) shares the internal token,
// session keys, and app key - only QCMS_LINK_KEYS varies across builds.
let baseEnv: Record<string, string | undefined>;

/** Build an app over the shared db with a given link-key list. */
function buildApp(linkKeys: string): { deps: Deps; app: ReturnType<typeof createApp> } {
  const d = makeDeps({
    db: testDb.db,
    clock: fixedClock(NOW),
    env: { ...baseEnv, QCMS_LINK_KEYS: linkKeys },
  });
  const a = createApp(d, ALL, {
    groups: { public: [registerStartSession], admin: [registerAdminAuth, registerLinks] },
  });
  return { deps: d, app: a };
}

beforeAll(async () => {
  testDb = await startTestDb();
  // A single fixed link key so mint (admin) and verify (start-session) share it.
  linkKeyA = synthSecret();
  baseEnv = validEnv({ QCMS_LINK_KEYS: linkKeyA });
  ({ deps, app } = buildApp(linkKeyA));
  internalToken = internalTokenFor(deps.config);

  await createForm(testDb.db, { formId: FORM_ID, slug: "links-it", defaultLocale: "en" });
  await insertFormVersion(testDb.db, {
    formId: FORM_ID,
    definition: emptyDef,
    compiled: emptyCompiled,
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  });
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
}, BOOT_TIMEOUT);

// --- request helpers --------------------------------------------------------

function adminHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: "editor-1",
  };
}

async function mint(targetApp: ReturnType<typeof createApp>, body: unknown): Promise<Response> {
  return targetApp.request(`/admin/forms/${FORM_ID}/links`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
}

/** Start a session from a link token via the public start-session slice. */
async function startFromToken(
  targetApp: ReturnType<typeof createApp>,
  token: string,
): Promise<Response> {
  return targetApp.request("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-qcms-internal-token": internalToken },
    body: JSON.stringify({ token }),
  });
}

/** Pull the compact token out of a minted `/l/<token>` URL. */
function tokenFromUrl(url: string): string {
  const marker = "/l/";
  return url.slice(url.indexOf(marker) + marker.length);
}

// --- tests ------------------------------------------------------------------

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

    // The minted token verifies under the deployment's link keys (018's engine).
    const token = tokenFromUrl(link.url);
    const keys = await Promise.all(
      deps.config.keys.link.map((k) => importCompactTokenKey(new TextEncoder().encode(k))),
    );
    const verified = await verifySecureLink(token, keys, NOW, FORM_ID);
    expect(verified.ok).toBe(true);

    // ...and drives start-session end-to-end → a session pinned to the form.
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

    const revoked = await app.request(`/admin/links/${linkId}/revoke`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(revoked.status).toBe(200);
    expect((await revoked.json()) as { state: string }).toMatchObject({ state: "revoked" });

    // 018 rejects thereafter (signature is valid, but the row forbids use).
    const started = await startFromToken(app, token);
    expect(started.status).toBe(403);
    expect((await started.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "LINK_REVOKED" },
    });

    // A second revoke is not in a revocable state → 404.
    const again = await app.request(`/admin/links/${linkId}/revoke`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(again.status).toBe(404);
  });

  it("mints a batch and rejects a count over the documented cap", async () => {
    const res = await mint(app, { expiresAt: FUTURE, oneTime: true, count: 5 });
    expect(res.status).toBe(201);
    const { links } = (await res.json()) as { links: unknown[] };
    expect(links).toHaveLength(5);

    const over = await mint(app, { expiresAt: FUTURE, count: MAX_LINK_BATCH + 1 });
    expect(over.status).toBe(400); // zod max(cap) rejects before any row is written
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
    // The revoked link from an earlier test is present with state "revoked".
    expect(links.some((l) => l.state === "revoked" && l.revokedAt !== null)).toBe(true);
    expect(links.every((l) => ["active", "consumed", "expired", "revoked"].includes(l.state))).toBe(
      true,
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
    // Mint under the original key (app/deps built with linkKeyA).
    const res = await mint(app, { expiresAt: FUTURE, oneTime: false });
    const { links } = (await res.json()) as { links: Array<{ linkId: string; url: string }> };
    const token = tokenFromUrl(links[0]!.url);

    // Rotate: a brand-new key signs, the old key still verifies (prepend newest).
    const linkKeyB = synthSecret();
    const rotated = buildApp(`${linkKeyB} ${linkKeyA}`);

    // The old-key token still starts a session on the rotated app.
    const started = await startFromToken(rotated.app, token);
    expect(started.status).toBe(201);

    // And a fresh mint on the rotated app (signed with the new key) also verifies.
    const freshRes = await mint(rotated.app, { expiresAt: FUTURE });
    const fresh = (await freshRes.json()) as { links: Array<{ url: string }> };
    const freshStarted = await startFromToken(rotated.app, tokenFromUrl(fresh.links[0]!.url));
    expect(freshStarted.status).toBe(201);
  });
});
