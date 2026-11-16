import pngjs from "pngjs";
import { listAccessAudit } from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { registerRequestEnvironment } from "../../middleware/request-environment.js";
import { internalTokenFor, makeDeps, seedAdminSession, seedGrants, validEnv } from "../../test-support.js";
import { registerLogos } from "../logos/route.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { FakeBrandFetcher } from "./brand-fetcher/fake.js";
import { DeriveResult } from "./schema.js";
import { registerWorkspaces } from "./route.js";
import { registerThemeDerive } from "./theme-derive.js";

const TIMEOUT_MS = 30_000;
const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const FLAGS_ON = { QCMS_FLAG_AGENT_AUTHORING: "fake", QCMS_FLAG_THEME_DERIVE: "on" } as const;

function logoPng(): Buffer {
  const image = new pngjs.PNG({ width: 4, height: 4 });
  image.data.fill(0x5a);
  return pngjs.PNG.sync.write(image);
}

const PAGE = `<!doctype html><html><head><title>Brand home</title>
<meta name="theme-color" content="#0f766e">
<link rel="apple-touch-icon" href="/touch.png">
<style>body{color:#111111;background:#ffffff;font-family:Inter,sans-serif}</style>
</head><body><img alt="Brand logo" src="/touch.png"></body></html>`;

function site(): FakeBrandFetcher {
  return new FakeBrandFetcher()
    .serve("https://brand.example/", { contentType: "text/html", body: PAGE })
    .serve("https://brand.example/touch.png", { contentType: "image/png", body: logoPng() })
    .serve("https://brand.example/json", { contentType: "application/json", body: "{}" })
    .serve("https://svg.brand.example/", {
      contentType: "text/html",
      body: '<!doctype html><meta name="theme-color" content="#123456"><link rel="icon" type="image/png" href="/i.png">',
    })
    .serve("https://svg.brand.example/i.png", { contentType: "image/svg+xml", body: "<svg/>" });
}

let testDb: TestDb;
let internalToken: string;
let editor: { token: string; userId: string };

/** One set of synthetic keys, so every composition accepts the same channel token. */
const BASE_ENV = validEnv(FLAGS_ON);

function compose(
  env: Record<string, string | undefined>,
  fetcher: FakeBrandFetcher,
): { app: ReturnType<typeof createApp>; deps: Deps } {
  const deps = makeDeps({ db: testDb.db, env: { ...BASE_ENV, ...env }, brandFetcher: fetcher });
  const app = createApp(deps, ADMIN_ONLY, {
    groups: {
      admin: [
        registerAdminAuth,
        registerRequestEnvironment,
        registerGrantCheck,
        registerWorkspaces,
        registerThemeDerive,
      ],
    },
  });
  return { app, deps };
}

let fetcher: FakeBrandFetcher;
let on: ReturnType<typeof compose>;

beforeAll(async () => {
  testDb = await startTestDb();
  fetcher = site();
  on = compose({}, fetcher);
  internalToken = internalTokenFor(on.deps.config);
  editor = await seedAdminSession(testDb.db, { label: "derive-editor" });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

async function as(
  app: ReturnType<typeof createApp>,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return app.request(`/admin${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": internalTokenFor(on.deps.config),
      [ADMIN_SESSION_HEADER]: token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function derive(
  workspaceId: string,
  url: string,
  token: string = editor.token,
  app: ReturnType<typeof createApp> = on.app,
): Promise<Response> {
  return as(app, token, "POST", `/workspaces/${workspaceId}/themes/derive`, { url });
}

let counter = 0;

async function newWorkspace(label: string): Promise<string> {
  counter += 1;
  const slug = `${label}-${String(counter)}`;
  const res = await as(on.app, editor.token, "POST", "/workspaces", { name: slug, slug });
  expect(res.status, await res.clone().text()).toBe(201);
  const { workspace } = (await res.json()) as { workspace: { workspaceId: string } };
  await seedGrants(testDb.db, { userId: editor.userId, workspaceId: workspace.workspaceId });
  return workspace.workspaceId;
}

async function deriveRows(workspaceId: string): Promise<{ actor: string; detail: string }[]> {
  const { rows } = await listAccessAudit(testDb.db, workspaceId, { kind: "derive", limit: 50 });
  return rows.map((row) => ({ actor: row.actor ?? "", detail: row.detail ?? "" }));
}

describe("the derive route's own flag (SEC-18 S1)", { timeout: TIMEOUT_MS }, () => {
  it("is 404 with the agent flag on and the SEC-18 flag off", async () => {
    const workspaceId = await newWorkspace("derive-flag-off");
    const offFetcher = site();
    const off = compose({ QCMS_FLAG_THEME_DERIVE: undefined }, offFetcher);
    expect(off.deps.config.flags.agentAuthoring).toBe("fake");
    expect(off.deps.config.flags.themeDerive).toBe("off");
    const res = await derive(workspaceId, "https://brand.example/", editor.token, off.app);
    expect(res.status).toBe(404);
    expect(offFetcher.requests).toStrictEqual([]);
    expect(await deriveRows(workspaceId)).toStrictEqual([]);
  });
});

describe("deriving a theme (criterion 119)", { timeout: TIMEOUT_MS }, () => {
  it("derives for an Edit forms holder, stores the re-encoded logo and writes one audit row", async () => {
    const workspaceId = await newWorkspace("derive-ok");
    const res = await derive(workspaceId, "https://brand.example/");
    expect(res.status, await res.clone().text()).toBe(200);
    const { derived } = (await res.json()) as { derived: unknown };
    const parsed = DeriveResult.parse(derived);
    expect(parsed.face).toBe("inter");
    expect(parsed.logoKey).toMatch(/^[0-9a-f]{64}$/u);
    const text = JSON.stringify(derived);
    expect(text).not.toContain("Brand home");
    expect(text).not.toContain("Brand logo");

    const respondent = createApp(on.deps, PUBLIC_ONLY, { groups: { respondent: [registerLogos] } });
    const served = await respondent.request(`/logos/${parsed.logoKey ?? ""}`, {
      headers: { "x-qcms-internal-token": internalToken },
    });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");

    expect(await deriveRows(workspaceId)).toStrictEqual([
      { actor: editor.userId, detail: "host=brand.example" },
    ]);
  });

  it("writes one row per fetch, a refused fetch included, and none for an address never fetched", async () => {
    const workspaceId = await newWorkspace("derive-rows");
    expect((await derive(workspaceId, "https://brand.example/")).status).toBe(200);
    expect((await derive(workspaceId, "https://brand.example/json")).status).toBe(422);
    expect((await derive(workspaceId, "http://brand.example/")).status).toBe(422);
    expect(await deriveRows(workspaceId)).toStrictEqual([
      { actor: editor.userId, detail: "host=brand.example" },
      { actor: editor.userId, detail: "host=brand.example" },
    ]);
  });

  it.each([
    ["a View forms holder", { grants: ["forms.viewer"], owner: false }],
    ["a Publish forms holder", { grants: ["forms.publisher"], owner: false }],
    ["a Workspace administrator with no Edit forms grant", { grants: [], owner: true }],
  ])("refuses %s, and fetches nothing", async (label, grant) => {
    const workspaceId = await newWorkspace("derive-refused");
    const caller = await seedAdminSession(testDb.db, {
      label: `derive-${label.replaceAll(/\W+/gu, "-").toLowerCase()}`,
      claim: false,
      workspaceId,
      ...grant,
    });
    const before = fetcher.requests.length;
    const res = await derive(workspaceId, "https://brand.example/", caller.token);
    expect(res.status).toBe(403);
    expect(fetcher.requests.length).toBe(before);
    expect(await deriveRows(workspaceId)).toStrictEqual([]);
  });

  it("refuses a Site administrator holding no Edit forms grant there, and an editor of another workspace", async () => {
    const workspaceId = await newWorkspace("derive-site-admin");
    const elsewhere = await newWorkspace("derive-elsewhere");
    const siteAdministrator = await seedAdminSession(testDb.db, {
      label: "derive-site-admin",
      membership: false,
    });
    const otherEditor = await seedAdminSession(testDb.db, {
      label: "derive-other-editor",
      claim: false,
      owner: false,
      workspaceId: elsewhere,
      grants: ["forms.editor"],
    });
    for (const token of [siteAdministrator.token, otherEditor.token]) {
      expect((await derive(workspaceId, "https://brand.example/", token)).status).toBe(403);
    }
    expect(await deriveRows(workspaceId)).toStrictEqual([]);
  });
});

describe("one refusal for every cause (SEC-18 F10)", { timeout: TIMEOUT_MS }, () => {
  it("answers byte-identical bodies whatever refused the fetch", async () => {
    const workspaceId = await newWorkspace("derive-uniform");
    // Its own limiter, so the earlier suites' derives leave this one's budget whole.
    const fresh = compose({}, site());
    const causes = [
      "http://brand.example/",
      "https://brand.example:8443/",
      "https://user:pw@brand.example/",
      "https://10.0.0.1/",
      "https://[::1]/",
      "https://unknown.example/",
      "https://brand.example/json",
      "https://svg.brand.example/",
      "not a url",
    ];
    const answers = await Promise.all(
      causes.map(async (url) => {
        const res = await derive(workspaceId, url, editor.token, fresh.app);
        return `${String(res.status)} ${await res.text()}`;
      }),
    );
    expect([...new Set(answers)]).toStrictEqual([answers[0]]);
    expect(answers[0]).toMatch(/^422 .*THEME_DERIVE_REFUSED/u);
  });
});

describe("rate limits per user and per workspace (SEC-18 W3)", { timeout: TIMEOUT_MS }, () => {
  it("refuses past the per-user budget, and past the workspace's across users", async () => {
    const limited = compose(
      {
        QCMS_RL_THEME_DERIVE_USER_MAX: "2",
        QCMS_RL_THEME_DERIVE_WORKSPACE_MAX: "3",
      },
      site(),
    );
    const workspaceId = await newWorkspace("derive-limits");
    const second = await seedAdminSession(testDb.db, {
      label: "derive-second-editor",
      claim: false,
      owner: false,
      workspaceId,
      grants: ["forms.editor"],
    });
    const statuses: number[] = [];
    for (const token of [editor.token, editor.token, editor.token, second.token, second.token]) {
      statuses.push((await derive(workspaceId, "https://brand.example/", token, limited.app)).status);
    }
    expect(statuses).toStrictEqual([200, 200, 429, 200, 429]);
  });
});
