import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import { FormId, LinkId, importCompactTokenKey, mintSecureLink } from "@roonga/qcms-core";
import type { FormDefinition } from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  closeFormInEnvironment,
  createForm,
  getSecureLink,
  insertFormRelease,
  insertFormVersion,
  insertSecureLink,
  reopenFormInEnvironment,
  schema,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  searchPathOptions,
  startTestDb,
  type TestDb,
} from "@roonga/qcms-db/testing";

import { createApp } from "../../../app.js";
import type { Databases } from "../../../environments.js";
import type { Deps } from "../../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../../middleware/admin-auth.js";
import { registerRequestEnvironment } from "../../../middleware/request-environment.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../../test-support.js";
import type { ChallengeVerifier } from "../challenge.js";
import { registerLinks } from "../../links/route.js";
import { registerForms } from "../../forms/route.js";
import { registerReleases } from "../../releases/route.js";
import { registerAnonymousEntry, registerLinkEntry, registerSessionStatus } from "./route.js";

const { Pool } = pg;

const LIVE_SET = ["test", "prod"] as const;

const MOUNTED = {
  public: true,
  internal: false,
  admin: true,
  environments: ["test"],
} as const;

// No non-prod respondent surface, which is what leaving `test` out of `QCMS_MOUNT` gives.
const PROD_ONLY = { public: true, internal: false, admin: true, environments: [] } as const;

let testDb: TestDb;
const executors = new Map<string, Executor>();
let control: Executor;
let app: ReturnType<typeof createApp>;
let prodOnlyApp: ReturnType<typeof createApp>;
let internalToken: string;
let linkKey: CryptoKey;
let adminSessionToken: string;

const strictVerifier: ChallengeVerifier = {
  verify: (token) => Promise.resolve({ ok: token === "good-token" }),
};

function databases(): Databases {
  return {
    control,
    names: [...LIVE_SET],
    defaultEnvironment: "prod",
    for: (environment: string) => {
      const found = executors.get(environment);
      if (found === undefined) throw new Error(`no pool for environment ${environment}`);
      return found;
    },
    forRequest: (environment?: string) => {
      const chosen = environment ?? "prod";
      return { environment: chosen, exec: executors.get(chosen)! };
    },
  };
}

const groups = {
  anonymous: [registerAnonymousEntry],
  respondent: [registerLinkEntry, registerSessionStatus],
  admin: [
    registerAdminAuth,
    registerRequestEnvironment,
    registerForms,
    registerReleases,
    registerLinks,
  ],
};

beforeAll(async () => {
  testDb = await startTestDb();
  for (const environment of LIVE_SET) {
    const pool = testDb.register(
      new Pool({ connectionString: testDb.connectionUri, options: searchPathOptions(environment) }),
      `${environment} pool`,
    );
    executors.set(environment, drizzle(pool, { schema }));
  }
  // Control-plane tables are schema-qualified, so any connection resolves them; `test`'s
  // is used so nothing here leans on `prod` being a default.
  control = executors.get("test")!;
  adminSessionToken = (await seedAdminSession(control)).token;

  // One for both apps: `validEnv()` mints a fresh secret per call, so two calls would
  // give the two apps different internal tokens.
  const env = validEnv({ QCMS_RL_SESSION_CREATE_MAX: "500" });
  const deps: Deps = makeDeps({ databases: databases(), env, challenge: strictVerifier });
  internalToken = internalTokenFor(deps.config);
  linkKey = await importCompactTokenKey(new TextEncoder().encode(deps.config.keys.link[0]));
  app = createApp(deps, MOUNTED, { groups });
  prodOnlyApp = createApp(deps, PROD_ONLY, { groups });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

function prefixOf(environment: string): string {
  return environment === "prod" ? "" : `/${environment}`;
}

function respondentHeaders(): Record<string, string> {
  return { "content-type": "application/json", "x-qcms-internal-token": internalToken };
}

function adminHeaders(environment?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: adminSessionToken,
    ...(environment === undefined ? {} : { "x-qcms-environment": environment }),
  };
}

async function redeem(
  environment: string,
  token: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  return app.request(`${prefixOf(environment)}/sessions/link`, {
    method: "POST",
    headers: respondentHeaders(),
    body: JSON.stringify({ token, ...extra }),
  });
}

async function enterAnonymously(environment: string, slug: string): Promise<Response> {
  return app.request(`${prefixOf(environment)}/sessions`, {
    method: "POST",
    headers: respondentHeaders(),
    body: JSON.stringify({ formSlug: slug }),
  });
}

interface MintedBody {
  links: Array<{ linkId: string; environment: string; url: string; expiresAt: string }>;
}
interface ErrBody {
  error: { code: string; message: string };
}

async function mint(
  formId: FormId,
  body: Record<string, unknown>,
  environment?: string,
): Promise<Response> {
  return app.request(`/admin/forms/${formId}/links`, {
    method: "POST",
    headers: adminHeaders(environment),
    body: JSON.stringify({ expiresAt: futureIso(), ...body }),
  });
}

function futureIso(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as CompiledForm;
let linkSeq = 0;

async function seedForm(
  label: string,
  releaseTo: readonly string[],
  opts: { challengeRequired?: boolean } = {},
): Promise<{ formId: FormId; slug: string }> {
  const formId = FormId.parse(`frm_${label}`);
  const slug = `${label}-slug`;
  await createForm(control, {
    formId,
    slug,
    workspaceId: SEED_WORKSPACE_ID,
    defaultLocale: "en",
    ...(opts.challengeRequired === undefined ? {} : { challengeRequired: opts.challengeRequired }),
  });
  await insertFormVersion(control, {
    formId,
    definition: emptyDef,
    compiled: emptyCompiled,
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  });
  for (const environment of releaseTo) {
    await insertFormRelease(control, {
      formId,
      environment,
      version: 1,
      releasedBy: "usr_fixture",
    });
  }
  return { formId, slug };
}

// At the query layer rather than through the mint route, so a case does not depend on the
// admin surface as well as the one thing it is about.
async function seedLink(
  formId: FormId,
  environment: string,
  opts: { oneTime?: boolean } = {},
): Promise<{ token: string; linkId: LinkId }> {
  linkSeq += 1;
  const linkId = LinkId.parse(`lnk_env${String(linkSeq)}`);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const oneTime = opts.oneTime ?? false;
  await insertSecureLink(control, { linkId, formId, environment, expiresAt, oneTime });
  const token = await mintSecureLink(
    { formId, linkId, expiresAt: expiresAt.toISOString(), oneTime },
    linkKey,
  );
  return { token, linkId };
}

async function sessionCount(environment: string, formId: FormId): Promise<number> {
  const res = await testDb.client.query<{ n: string }>(
    `select count(*) as n from data_${environment}.sessions where form_id = $1`,
    [formId],
  );
  return Number(res.rows[0]?.n ?? "-1");
}

describe("a prod link starts a prod session and a test link a test session (criterion 1)", () => {
  it("lands each session in its own environment's schema, with the token format unchanged", async () => {
    const { formId } = await seedForm("bothenvs", ["test", "prod"]);
    const prodLink = await seedLink(formId, "prod");
    const testLink = await seedLink(formId, "test");

    // Nothing in the token names an environment: the path names it and the stored row
    // decides it.
    expect(prodLink.token.split(".")).toHaveLength(2);
    expect(prodLink.token).not.toContain("prod");
    expect(testLink.token).not.toContain("test");

    expect((await redeem("prod", prodLink.token)).status).toBe(201);
    expect((await redeem("test", testLink.token)).status).toBe(201);

    expect(await sessionCount("prod", formId)).toBe(1);
    expect(await sessionCount("test", formId)).toBe(1);
  });
});

describe("the address carries the environment, and a wrong prefix is refused (criterion 2)", () => {
  it("prefixes a non-prod minted URL and leaves a prod one unprefixed", async () => {
    const { formId } = await seedForm("addresses", ["test", "prod"]);

    const inProd = await mint(formId, { environment: "prod" });
    expect(inProd.status).toBe(201);
    const prodUrl = ((await inProd.json()) as MintedBody).links[0]!.url;
    expect(new URL(prodUrl).pathname).toMatch(/^\/l\/[^/]+$/);

    const inTest = await mint(formId, { environment: "test" });
    expect(inTest.status).toBe(201);
    const minted = ((await inTest.json()) as MintedBody).links[0]!;
    expect(new URL(minted.url).pathname).toMatch(/^\/test\/l\/[^/]+$/);
    expect(minted.environment).toBe("test");
  });

  it("refuses the same token under the wrong prefix, rather than redirecting or honouring it", async () => {
    const { formId } = await seedForm("wrongprefix", ["test", "prod"]);
    const prodLink = await seedLink(formId, "prod", { oneTime: true });

    const atTest = await redeem("test", prodLink.token);
    // Not a redirect: that would turn a leaked production link into a working one for
    // anybody who found the test address.
    expect(atTest.status).toBe(404);
    expect(((await atTest.json()) as ErrBody).error.code).toBe("LINK_WRONG_ENVIRONMENT");

    expect((await getSecureLink(control, prodLink.linkId))?.consumedAt).toBeNull();
    expect(await sessionCount("test", formId)).toBe(0);
    expect((await redeem("prod", prodLink.token)).status).toBe(201);
  });

  it("refuses a test link at the prod address too, which is the same rule in reverse", async () => {
    const { formId } = await seedForm("reverseprefix", ["test", "prod"]);
    const testLink = await seedLink(formId, "test");

    const atProd = await redeem("prod", testLink.token);
    expect(atProd.status).toBe(404);
    expect(((await atProd.json()) as ErrBody).error.code).toBe("LINK_WRONG_ENVIRONMENT");
    expect(await sessionCount("prod", formId)).toBe(0);
  });
});

describe("there is no anonymous entry to a non-prod environment (criterion 3)", () => {
  it("answers 404 and not 403 for a form slug at a non-prod address", async () => {
    const { slug } = await seedForm("noanon", ["test", "prod"]);

    const atTest = await enterAnonymously("test", slug);
    // The route is not registered on this surface, so there is nothing to refuse: a 403
    // would mean a handler had looked at the request and decided (ADR-09).
    expect(atTest.status).toBe(404);

    expect((await enterAnonymously("prod", slug)).status).toBe(201);
  });

  it("serves no `/<env>/f/{slug}` shape at all, because the API has no such route", async () => {
    // The portal owns `/f/{slug}`; the API's anonymous door is `POST /sessions`.
    const { slug } = await seedForm("noslugroute", ["test"]);
    for (const method of ["GET", "POST"]) {
      const res = await app.request(`/test/f/${slug}`, {
        method,
        headers: respondentHeaders(),
      });
      expect(res.status).toBe(404);
    }
  });

  it("serves nothing at all for an environment left unmounted, link entry included", async () => {
    const { formId, slug } = await seedForm("unmounted", ["test"]);
    const link = await seedLink(formId, "test");

    const anon = await prodOnlyApp.request(`/test/sessions`, {
      method: "POST",
      headers: respondentHeaders(),
      body: JSON.stringify({ formSlug: slug }),
    });
    expect(anon.status).toBe(404);
    const redeemed = await prodOnlyApp.request(`/test/sessions/link`, {
      method: "POST",
      headers: respondentHeaders(),
      body: JSON.stringify({ token: link.token }),
    });
    expect(redeemed.status).toBe(404);
    expect(await sessionCount("test", formId)).toBe(0);
  });
});

describe("the link lifecycle behaves per environment as it does today (criterion 4)", () => {
  it("consumes a one-time link in its own environment only", async () => {
    const { formId } = await seedForm("onetime", ["test", "prod"]);
    const link = await seedLink(formId, "test", { oneTime: true });

    expect((await redeem("test", link.token)).status).toBe(201);
    const replay = await redeem("test", link.token);
    expect(replay.status).toBe(409);
    expect(((await replay.json()) as ErrBody).error.code).toBe("LINK_CONSUMED");
    expect((await getSecureLink(control, link.linkId))?.consumedAt).not.toBeNull();
  });

  it("revokes a link through the environment that minted it, and not through another", async () => {
    const { formId } = await seedForm("revoking", ["test", "prod"]);
    const minted = await mint(formId, { environment: "test" }, "test");
    const linkId = ((await minted.json()) as MintedBody).links[0]!.linkId;

    const wrong = await app.request(`/admin/forms/${formId}/links/${linkId}/revoke`, {
      method: "POST",
      headers: adminHeaders("prod"),
    });
    expect(wrong.status).toBe(404);

    const right = await app.request(`/admin/forms/${formId}/links/${linkId}/revoke`, {
      method: "POST",
      headers: adminHeaders("test"),
    });
    expect(right.status).toBe(200);
  });

  it("lists one environment's links and not another's", async () => {
    const { formId } = await seedForm("listing", ["test", "prod"]);
    await mint(formId, { environment: "test" }, "test");
    await mint(formId, { environment: "prod", count: 2 }, "prod");

    const inTest = await app.request(`/admin/forms/${formId}/links`, {
      headers: adminHeaders("test"),
    });
    const testRows = (await inTest.json()) as { links: Array<{ environment: string }> };
    expect(testRows.links).toHaveLength(1);
    expect(testRows.links.every((row) => row.environment === "test")).toBe(true);

    const inProd = await app.request(`/admin/forms/${formId}/links`, {
      headers: adminHeaders("prod"),
    });
    const prodRows = (await inProd.json()) as { links: Array<{ environment: string }> };
    expect(prodRows.links).toHaveLength(2);
    expect(prodRows.links.every((row) => row.environment === "prod")).toBe(true);
  });

  it("reads the challenge provider from the environment row (Q11)", async () => {
    const { formId } = await seedForm("challenged", ["test", "prod"], { challengeRequired: true });
    const inProd = await seedLink(formId, "prod");
    const inTest = await seedLink(formId, "test");

    // Both environments start on the installation-wide verifier, wired strict here.
    expect((await redeem("prod", inProd.token)).status).toBe(403);
    expect((await redeem("test", inTest.token)).status).toBe(403);

    await testDb.client.query(
      `update control.environments set challenge_provider = 'none' where name = 'test'`,
    );
    const second = await seedLink(formId, "test");
    expect((await redeem("test", second.token)).status).toBe(201);

    expect((await redeem("prod", inProd.token)).status).toBe(403);
    const solved = await redeem("prod", inProd.token, { challengeToken: "good-token" });
    expect(solved.status).toBe(201);

    // An unrecognised provider name fails closed rather than letting a challenged start
    // through.
    await testDb.client.query(
      `update control.environments set challenge_provider = 'nonesuch' where name = 'test'`,
    );
    const third = await seedLink(formId, "test");
    expect((await redeem("test", third.token)).status).toBe(403);
    await testDb.client.query(
      `update control.environments set challenge_provider = null where name = 'test'`,
    );
  });
});

describe("the closed state is per environment (criterion 5, Q18)", () => {
  it("closes prod and leaves an open test run serving, and the reverse", async () => {
    const { formId, slug } = await seedForm("closedsplit", ["test", "prod"]);

    const closeProd = await app.request(`/admin/forms/${formId}/close`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ environment: "prod" }),
    });
    expect(closeProd.status).toBe(200);
    expect((await closeProd.json()) as unknown).toMatchObject({
      environment: "prod",
      status: "closed",
    });

    expect((await enterAnonymously("prod", slug)).status).toBe(409);
    const prodLink = await seedLink(formId, "prod");
    expect((await redeem("prod", prodLink.token)).status).toBe(409);

    const testLink = await seedLink(formId, "test");
    expect((await redeem("test", testLink.token)).status).toBe(201);

    await app.request(`/admin/forms/${formId}/reopen`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ environment: "prod" }),
    });
    await app.request(`/admin/forms/${formId}/close`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ environment: "test" }),
    });
    expect((await enterAnonymously("prod", slug)).status).toBe(201);
    const secondTestLink = await seedLink(formId, "test");
    expect((await redeem("test", secondTestLink.token)).status).toBe(409);
  });

  it("refuses a link into a closed environment without consuming it or charging a challenge", async () => {
    const { formId } = await seedForm("closednospend", ["test"], { challengeRequired: true });
    const link = await seedLink(formId, "test", { oneTime: true });
    await closeFormInEnvironment(control, {
      formId,
      environment: "test",
      closedBy: "usr_fixture",
    });

    const refused = await redeem("test", link.token);
    expect(refused.status).toBe(409);
    // The closed state is read before the challenge, so no challenge is charged.
    expect(((await refused.json()) as ErrBody).error.code).toBe("FORM_CLOSED");
    expect((await getSecureLink(control, link.linkId))?.consumedAt).toBeNull();
    expect(await sessionCount("test", formId)).toBe(0);

    await reopenFormInEnvironment(control, {
      formId,
      environment: "test",
      reopenedBy: "usr_fixture",
    });
    expect((await redeem("test", link.token, { challengeToken: "good-token" })).status).toBe(201);
  });

  it("refuses closing an environment with nothing released there, and a second close", async () => {
    const { formId } = await seedForm("closerefusals", ["prod"]);

    const nothingReleased = await app.request(`/admin/forms/${formId}/close`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ environment: "test" }),
    });
    expect(nothingReleased.status).toBe(409);
    expect(((await nothingReleased.json()) as ErrBody).error.code).toBe("NOT_RELEASED");

    const closed = await app.request(`/admin/forms/${formId}/close`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ environment: "prod" }),
    });
    expect(closed.status).toBe(200);
    const again = await app.request(`/admin/forms/${formId}/close`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ environment: "prod" }),
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrBody).error.code).toBe("ALREADY_CLOSED");
  });

  it("does not reopen a closed environment by releasing a new version there", async () => {
    const { formId, slug } = await seedForm("closedrelease", ["prod"]);
    await app.request(`/admin/forms/${formId}/close`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ environment: "prod" }),
    });
    await insertFormVersion(control, {
      formId,
      definition: emptyDef,
      compiled: emptyCompiled,
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
    });

    await app.request(`/admin/forms/${formId}/releases`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ environment: "test", version: 2 }),
    });
    const released = await app.request(`/admin/forms/${formId}/releases`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ environment: "prod", version: 2 }),
    });
    expect(released.status).toBe(200);
    expect((await enterAnonymously("prod", slug)).status).toBe(409);
  });
});

describe("minting without an environment is refused (criterion 6, Q19)", () => {
  it("refuses a body that omits the field, naming it", async () => {
    const { formId } = await seedForm("mintnoenv", ["prod"]);
    const res = await app.request(`/admin/forms/${formId}/links`, {
      method: "POST",
      headers: adminHeaders("prod"),
      body: JSON.stringify({ expiresAt: futureIso() }),
    });
    // No default: the switcher's header is set on this request and is not consulted as a
    // fallback, so a script that omits the field cannot silently get a production link.
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrBody & { error: { details?: unknown } };
    expect(JSON.stringify(body.error.details)).toContain("environment");
  });

  it("refuses an environment this deployment does not serve", async () => {
    const { formId } = await seedForm("mintunknownenv", ["prod"]);
    const res = await mint(formId, { environment: "staging" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrBody).error.code).toBe("UNKNOWN_ENVIRONMENT");
  });
});

describe("a prod respondent's address and experience are unchanged (criterion 7)", () => {
  it("serves the form slug and the link at exactly the addresses they had", async () => {
    const { formId, slug } = await seedForm("produnchanged", ["prod"]);
    const link = await seedLink(formId, "prod");

    expect((await enterAnonymously("prod", slug)).status).toBe(201);
    const started = await redeem("prod", link.token);
    expect(started.status).toBe(201);

    const session = (await started.json()) as { sessionId: string; sessionToken: string };
    const status = await app.request(`/sessions/${session.sessionId}`, {
      headers: {
        "x-qcms-internal-token": internalToken,
        authorization: `Bearer ${session.sessionToken}`,
      },
    });
    expect(status.status).toBe(200);
  });
});
