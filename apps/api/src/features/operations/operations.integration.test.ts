/**
 * The read model persona by persona, against a real Postgres. Requires Docker. A pool per
 * environment, because "submitted in `prod` and not in `test`" is a claim one shared
 * handle cannot fail.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FormId, SessionId } from "@roonga/qcms-core";
import type { FormDefinition, LockedSubmission } from "@roonga/qcms-core";
import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import {
  SEED_WORKSPACE_ID,
  addAccessGroupHolder,
  authOrganization,
  createAccessGroup,
  createForm,
  createSession,
  ensureWorkspaceMember,
  insertFormRelease,
  insertFormVersion,
  insertSubmission,
  listAccessGroups,
  listFormReleases,
  markSubmitted,
  removeAccessGroupHolder,
  schema,
  setRequireSecondApprover,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  searchPathOptions,
  startTestDb,
  type TestDb,
} from "@roonga/qcms-db/testing";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import type { Databases } from "../../environments.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { registerRequestEnvironment } from "../../middleware/request-environment.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { registerMembership } from "../membership/route.js";
import { registerReleases } from "../releases/route.js";
import { registerOperations } from "./route.js";

const { Pool } = pg;

const LIVE_SET = ["test", "prod"] as const;
const MOUNTED = { public: false, internal: false, admin: true } as const;

/** The second workspace, for the cross-workspace personas. */
const OTHER_WORKSPACE = "org_ops_other";
/** A third workspace, so the non-ASCII forms disturb no other case's row list. */
const UNICODE_WORKSPACE = "org_ops_unicode";

/** Three forms: two in the seeded workspace and one in the second. */
const FORM_CLAIMS = FormId.parse("frm_ops_claims");
const FORM_PERMITS = FormId.parse("frm_ops_permits");
const FORM_OTHER = FormId.parse("frm_ops_other");
const FORM_UNICODE_A = FormId.parse("frm_ops_unicode_a");
const FORM_UNICODE_B = FormId.parse("frm_ops_unicode_b");

let testDb: TestDb;
const executors = new Map<string, Executor>();
let control: Executor;
let app: ReturnType<typeof createApp>;
let internalToken: string;

interface Persona {
  readonly token: string;
  readonly userId: string;
}

/** The persona list, seeded in `beforeAll`. */
let viewer: Persona;
let testEditor: Persona;
let prodApprover: Persona;
let oneFormViewer: Persona;
let eraser: Persona;
let workspaceOwner: Persona;
let installationAdmin: Persona;
let combined: Persona;
let nobody: Persona;
let revoked: Persona;
let unicodeViewer: Persona;
/** The same ten by name, for the cases that walk all of them. */
let everyPersona: readonly (readonly [string, Persona])[];

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

/**
 * Seed one account with scoped access groups. `seedGrants` seeds `all` scopes only, and
 * the scopes are the point of half these personas.
 */
async function persona(
  label: string,
  grants: readonly {
    readonly role: string;
    readonly environments: readonly string[];
    readonly forms: readonly string[];
    readonly workspaceId?: string;
  }[],
  options: { readonly owner?: boolean; readonly claim?: boolean } = {},
): Promise<Persona> {
  // No claim by default: it is `forms.owner` in every workspace, so leaving it on would
  // assert the claim rather than the role.
  const seeded = await seedAdminSession(control, {
    label,
    grants: [],
    owner: options.owner ?? false,
    claim: options.claim ?? false,
  });
  for (const grant of grants) {
    const workspaceId = grant.workspaceId ?? SEED_WORKSPACE_ID;
    await ensureWorkspaceMember(control, workspaceId, seeded.userId);
    const group = await createAccessGroup(control, {
      workspaceId,
      name: `${label}.${grant.environments.join("-")}.${grant.role}`,
      role: grant.role,
      environments: [...grant.environments],
      forms: [...grant.forms],
    });
    await addAccessGroupHolder(control, group.teamId, seeded.userId);
  }
  return seeded;
}

const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as CompiledForm;

/** A form with one published version carrying a title, so the display name is derived. */
async function seedForm(
  formId: FormId,
  slug: string,
  workspaceId: string,
  title?: string,
): Promise<void> {
  await createForm(control, { formId, slug, workspaceId, defaultLocale: "en" });
  await insertFormVersion(control, {
    formId,
    definition: { title: { en: title ?? `${slug} form` } } as unknown as FormDefinition,
    compiled: emptyCompiled,
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1.0.0",
    publishedBy: "au_someone_else",
  });
}

/** A submitted response in one environment, so a count has something to count. */
async function seedSubmitted(environment: string, formId: FormId, suffix: string): Promise<void> {
  const exec = executors.get(environment)!;
  const sessionId = SessionId.parse(`ses_ops${suffix}`);
  await createSession(exec, {
    environment,
    sessionId,
    formId,
    formVersion: 1,
    accessMode: "anonymous",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await markSubmitted(exec, sessionId);
  await insertSubmission(exec, {
    sessionId,
    contentHash: "0".repeat(64),
    lockedAnswers: {} as unknown as LockedSubmission,
    submittedAt: new Date(),
  });
}

/** A session still open in one environment, which is the `inProgress` half of a count. */
async function seedInProgress(environment: string, formId: FormId, suffix: string): Promise<void> {
  const exec = executors.get(environment)!;
  await createSession(exec, {
    environment,
    sessionId: SessionId.parse(`ses_ops${suffix}`),
    formId,
    formVersion: 1,
    accessMode: "anonymous",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
}

beforeAll(async () => {
  testDb = await startTestDb();
  for (const environment of LIVE_SET) {
    const pool = testDb.register(
      new Pool({ connectionString: testDb.connectionUri, options: searchPathOptions(environment) }),
      `${environment} pool`,
    );
    executors.set(environment, drizzle(pool, { schema }));
  }
  control = executors.get("test")!;

  await control
    .insert(authOrganization)
    .values({ id: OTHER_WORKSPACE, name: "ops-other", slug: "ops-other" })
    .onConflictDoNothing({ target: authOrganization.id });
  await control
    .insert(authOrganization)
    .values({ id: UNICODE_WORKSPACE, name: "ops-unicode", slug: "ops-unicode" })
    .onConflictDoNothing({ target: authOrganization.id });

  await seedForm(FORM_CLAIMS, "ops-claims", SEED_WORKSPACE_ID);
  await seedForm(FORM_PERMITS, "ops-permits", SEED_WORKSPACE_ID);
  await seedForm(FORM_OTHER, "ops-other-form", OTHER_WORKSPACE);
  await seedForm(
    FORM_UNICODE_A,
    "ops-\u00fcbersicht",
    UNICODE_WORKSPACE,
    "\u00dcbersicht \u00fcber Antr\u00e4ge",
  );
  await seedForm(
    FORM_UNICODE_B,
    "ops-\u7533\u8acb",
    UNICODE_WORKSPACE,
    "\u7533\u8acb\u66f8\u30d5\u30a9\u30fc\u30e0",
  );

  // `claims` open in `prod` and `test`, `permits` released and closed in `prod`, `other`
  // never released: the three intake readings.
  await insertFormRelease(control, {
    formId: FORM_CLAIMS,
    environment: "test",
    version: 1,
    releasedBy: "au_seed",
  });
  await insertFormRelease(control, {
    formId: FORM_CLAIMS,
    environment: "prod",
    version: 1,
    releasedBy: "au_seed",
  });
  await insertFormRelease(control, {
    formId: FORM_PERMITS,
    environment: "prod",
    version: 1,
    releasedBy: "au_seed",
    closed: true,
  });

  await seedSubmitted("prod", FORM_CLAIMS, "p1");
  await seedSubmitted("prod", FORM_CLAIMS, "p2");
  await seedInProgress("prod", FORM_CLAIMS, "p3");
  await seedSubmitted("test", FORM_CLAIMS, "t1");

  viewer = await persona("opsviewer", [
    { role: "forms.viewer", environments: ["all"], forms: ["all"] },
  ]);
  testEditor = await persona("opstesteditor", [
    { role: "forms.editor", environments: ["test"], forms: ["all"] },
  ]);
  prodApprover = await persona("opsprodapprover", [
    { role: "forms.approver", environments: ["prod"], forms: ["all"] },
  ]);
  oneFormViewer = await persona("opsoneform", [
    { role: "responses.viewer", environments: ["prod"], forms: [FORM_CLAIMS] },
  ]);
  eraser = await persona("opseraser", [
    { role: "responses.eraser", environments: ["all"], forms: ["all"] },
  ]);
  workspaceOwner = await persona("opsowner", [], { owner: true });
  installationAdmin = await seedAdminSession(control, {
    label: "opsclaim",
    membership: false,
  });
  combined = await persona("opscombined", [
    { role: "forms.viewer", environments: ["all"], forms: ["all"] },
    {
      role: "responses.viewer",
      environments: ["all"],
      forms: ["all"],
      workspaceId: OTHER_WORKSPACE,
    },
  ]);
  nobody = await seedAdminSession(control, {
    label: "opsnobody",
    grants: [],
    owner: false,
    claim: false,
  });
  revoked = await persona("opsrevoked", [
    { role: "responses.viewer", environments: ["all"], forms: ["all"] },
  ]);

  unicodeViewer = await persona("opsunicode", [
    { role: "forms.viewer", environments: ["all"], forms: ["all"], workspaceId: UNICODE_WORKSPACE },
  ]);

  everyPersona = [
    ["forms viewer", viewer],
    ["test-only editor", testEditor],
    ["prod-only approver", prodApprover],
    ["one-form response viewer", oneFormViewer],
    ["eraser without viewer", eraser],
    ["workspace-only owner", workspaceOwner],
    ["installation administrator", installationAdmin],
    ["combined grants", combined],
    ["no grants at all", nobody],
    ["revoked", revoked],
    ["non-ASCII workspace viewer", unicodeViewer],
  ];

  const deps: Deps = makeDeps({ databases: databases(), env: validEnv() });
  internalToken = internalTokenFor(deps.config);
  app = createApp(deps, MOUNTED, {
    groups: {
      admin: [
        registerAdminAuth,
        registerRequestEnvironment,
        registerGrantCheck,
        registerMembership,
        registerOperations,
        registerReleases,
      ],
    },
  });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

function headers(token: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: token,
  };
}

interface OperationsRow {
  formId: string;
  slug: string;
  displayName: string;
  workspace: { workspaceId: string };
  hasRelease: boolean;
  release: { version: number; closed: boolean; releasedAt: string } | null;
  lastReleaseAt: string | null;
  counts: { submitted: number; inProgress: number } | null;
  capabilities: string[];
}

interface OperationsBody {
  environment: string;
  forms: OperationsRow[];
  total: number;
  nextCursor: string | null;
  workspaces: { workspaceId: string }[];
}

async function operations(
  token: string,
  query: string,
): Promise<{ status: number; body: OperationsBody }> {
  const res = await app.request(`/admin/operations/forms?${query}`, { headers: headers(token) });
  return { status: res.status, body: (await res.json()) as OperationsBody };
}

/** The slugs one persona is served, sorted, which is the subset half of every case. */
async function slugsFor(token: string, query = "environment=prod"): Promise<string[]> {
  const { body } = await operations(token, query);
  return body.forms.map((row) => row.slug).sort();
}

describe("operations discovery: which rows each persona is served", () => {
  it("serves a forms viewer every form in its workspace, with release state and no counts", async () => {
    const { status, body } = await operations(viewer.token, "environment=prod");
    expect(status).toBe(200);
    // Its own workspace's two forms, and not the second workspace's.
    expect(body.forms.map((row) => row.slug)).toEqual(["ops-claims", "ops-permits"]);
    const claims = body.forms.find((row) => row.slug === "ops-claims");
    expect(claims?.release?.version).toBe(1);
    expect(claims?.release?.closed).toBe(false);
    expect(typeof claims?.release?.releasedAt).toBe("string");
    expect(claims?.hasRelease).toBe(true);
    expect(claims?.lastReleaseAt).not.toBeNull();
    expect(claims?.counts).toBeNull();
    // Empty rather than absent: the field is derived from the policy, not a role name.
    expect(claims?.capabilities).toEqual([]);
    // From the published version's title, never a draft.
    expect(claims?.displayName).toBe("ops-claims form");
  });

  it("tells unreleased from closed from open, which are three answers and not two", async () => {
    const { body } = await operations(viewer.token, "environment=prod");
    const permits = body.forms.find((row) => row.slug === "ops-permits");
    expect(permits?.hasRelease).toBe(true);
    expect(permits?.release?.closed).toBe(true);
    expect(await slugsFor(viewer.token, "environment=prod&intake=closed")).toEqual(["ops-permits"]);
    expect(await slugsFor(viewer.token, "environment=prod&intake=open")).toEqual(["ops-claims"]);
    // `permits` reads unreleased in `test`, which is not closed.
    expect(await slugsFor(viewer.token, "environment=test&intake=unreleased")).toEqual([
      "ops-permits",
    ]);
  });

  it("gives a test-only editor its writes in test and none of them in prod", async () => {
    const inTest = await operations(testEditor.token, "environment=test");
    const claimsInTest = inTest.body.forms.find((row) => row.slug === "ops-claims");
    expect(claimsInTest?.capabilities).toContain("release:create");
    expect(claimsInTest?.capabilities).toContain("link:mint");
    const inProd = await operations(testEditor.token, "environment=prod");
    const claimsInProd = inProd.body.forms.find((row) => row.slug === "ops-claims");
    // The row is still served, since `form: read` is workspace-wide, and every production
    // write is absent: the matrix's split rather than the scope.
    expect(claimsInProd?.release).not.toBeNull();
    expect(claimsInProd?.capabilities).toEqual([]);
  });

  it("gives a prod-only approver its writes in prod and none in test", async () => {
    const inProd = await operations(prodApprover.token, "environment=prod");
    const claims = inProd.body.forms.find((row) => row.slug === "ops-claims");
    expect(claims?.capabilities).toContain("release:create");
    expect(claims?.capabilities).toContain("webhook:configure");
    // No response cell from an authoring role, in any environment.
    expect(claims?.capabilities).not.toContain("response:read");
    expect(claims?.counts).toBeNull();
    const inTest = await operations(prodApprover.token, "environment=test");
    expect(inTest.body.forms.find((row) => row.slug === "ops-claims")?.capabilities).toEqual([]);
  });

  it("restricts a one-form response viewer to that form, that environment, and no versions", async () => {
    const inProd = await operations(oneFormViewer.token, "environment=prod");
    expect(inProd.body.forms.map((row) => row.slug)).toEqual(["ops-claims"]);
    const claims = inProd.body.forms[0];
    expect(claims?.counts).toEqual({ submitted: 2, inProgress: 1 });
    // No version, intake, draft or last release: `hasRelease` is all it is told.
    expect(claims?.release).toBeNull();
    expect(claims?.lastReleaseAt).toBeNull();
    expect(claims?.hasRelease).toBe(true);
    expect(claims?.capabilities).toEqual(["response:export"]);
    expect(JSON.stringify(inProd.body)).not.toContain("hasDraft");
    expect(JSON.stringify(inProd.body)).not.toContain("latestVersion");

    // In `test`, where it holds nothing: an empty page rather than a refusal.
    const inTest = await operations(oneFormViewer.token, "environment=test");
    expect(inTest.status).toBe(200);
    expect(inTest.body.forms).toEqual([]);
    expect(inTest.body.total).toBe(0);
  });

  it("serves an eraser its forms with no counts and no read capability", async () => {
    const { body } = await operations(eraser.token, "environment=prod");
    expect(body.forms.map((row) => row.slug).sort()).toEqual(["ops-claims", "ops-permits"]);
    const claims = body.forms.find((row) => row.slug === "ops-claims");
    expect(claims?.counts).toBeNull();
    expect(claims?.release).toBeNull();
    expect(claims?.capabilities).toEqual(["response:erase", "response:dispose"]);
    expect(claims?.capabilities).not.toContain("response:export");
  });

  it("refuses a workspace-only owner, who reaches no form cell anywhere", async () => {
    const res = await app.request("/admin/operations/forms?environment=prod", {
      headers: headers(workspaceOwner.token),
    });
    expect(res.status).toBe(403);
  });

  it("refuses an installation administrator with no data grants (G06)", async () => {
    const res = await app.request("/admin/operations/forms?environment=prod", {
      headers: headers(installationAdmin.token),
    });
    expect(res.status).toBe(403);
  });

  it("refuses a signed-in caller with no grants and no claim", async () => {
    const res = await app.request("/admin/operations/forms?environment=prod", {
      headers: headers(nobody.token),
    });
    expect(res.status).toBe(403);
  });

  it("unions combined grants held in two different workspaces", async () => {
    const { body } = await operations(combined.token, "environment=prod");
    expect(body.forms.map((row) => row.slug).sort()).toEqual([
      "ops-claims",
      "ops-other-form",
      "ops-permits",
    ]);
    // Release fields where the authoring grant is, counts where the response grant is.
    expect(body.forms.find((row) => row.slug === "ops-claims")?.counts).toBeNull();
    expect(body.forms.find((row) => row.slug === "ops-claims")?.release).not.toBeNull();
    const other = body.forms.find((row) => row.slug === "ops-other-form");
    expect(other?.counts).toEqual({ submitted: 0, inProgress: 0 });
    expect(other?.release).toBeNull();
    expect(other?.hasRelease).toBe(false);
    // Both workspaces as filter options, and only those two.
    expect(body.workspaces.map((workspace) => workspace.workspaceId).sort()).toEqual(
      [OTHER_WORKSPACE, SEED_WORKSPACE_ID].sort(),
    );
  });

  it("stops serving rows the moment a grant is revoked", async () => {
    expect(await slugsFor(revoked.token)).toEqual(["ops-claims", "ops-permits"]);
    const groups = await listAccessGroups(control, SEED_WORKSPACE_ID);
    const group = groups.find((row) => row.name.startsWith("opsrevoked."));
    expect(group).toBeDefined();
    await removeAccessGroupHolder(control, group!.teamId, revoked.userId);
    const res = await app.request("/admin/operations/forms?environment=prod", {
      headers: headers(revoked.token),
    });
    expect(res.status).toBe(403);
  });
});

describe("operations discovery: bounds, filters and pagination", () => {
  it("refuses an environment this deployment does not serve, naming no other", async () => {
    const res = await app.request("/admin/operations/forms?environment=staging", {
      headers: headers(viewer.token),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.message).not.toContain("prod");
  });

  it("refuses a request that names no environment, rather than defaulting one", async () => {
    const res = await app.request("/admin/operations/forms", {
      headers: headers(viewer.token),
    });
    expect(res.status).toBe(400);
  });

  it("filters on the search term, the workspace and the intake, and totals the filtered set", async () => {
    const searched = await operations(viewer.token, "environment=prod&q=claims");
    expect(searched.body.forms.map((row) => row.slug)).toEqual(["ops-claims"]);
    expect(searched.body.total).toBe(1);
    // The options do not shrink with the filter.
    expect(searched.body.workspaces.length).toBeGreaterThan(0);
    const other = await operations(
      combined.token,
      `environment=prod&workspaceId=${OTHER_WORKSPACE}`,
    );
    expect(other.body.forms.map((row) => row.slug)).toEqual(["ops-other-form"]);
    expect(other.body.total).toBe(1);
  });

  it("pages on a stable cursor and refuses one issued for another order", async () => {
    const first = await operations(viewer.token, "environment=prod&limit=1&sort=slug-asc");
    expect(first.body.forms.map((row) => row.slug)).toEqual(["ops-claims"]);
    expect(first.body.total).toBe(2);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await operations(
      viewer.token,
      `environment=prod&limit=1&sort=slug-asc&cursor=${encodeURIComponent(first.body.nextCursor!)}`,
    );
    expect(second.body.forms.map((row) => row.slug)).toEqual(["ops-permits"]);
    expect(second.body.nextCursor).toBeNull();

    const mismatched = await app.request(
      `/admin/operations/forms?environment=prod&sort=slug-desc&cursor=${encodeURIComponent(
        first.body.nextCursor!,
      )}`,
      { headers: headers(viewer.token) },
    );
    expect(mismatched.status).toBe(400);
    expect(((await mismatched.json()) as { error: { code: string } }).error.code).toBe(
      "CURSOR_SORT_MISMATCH",
    );

    const bad = await app.request("/admin/operations/forms?environment=prod&cursor=not-a-cursor", {
      headers: headers(viewer.token),
    });
    expect(bad.status).toBe(400);
  });

  it("refuses every shape of malformed cursor as INVALID_CURSOR", async () => {
    // `base64url` is already unpadded, so these are the shapes the route accepts as
    // cursors and rejects as payloads.
    const encode = (text: string): string => Buffer.from(text, "utf8").toString("base64url");
    const whole = '"sort":"released-asc","slug":"ops-claims","formId":"frm_ops_claims"';
    const cursors = [
      "not a cursor!",
      encode("plain text"),
      encode("[1,2,3]"),
      encode('"a string"'),
      encode("{}"),
      encode('{"sort":"slug-asc"}'),
      encode('{"sort":"slug-asc","slug":"ops-claims","formId":42}'),
      encode('{"sort":1,"slug":"ops-claims","formId":"frm_ops_claims"}'),
      // `released` is read back as a Date on a released sort, so a string that is not a
      // timestamp would throw inside the comparator rather than refuse here.
      encode(`{${whole},"released":"not-a-date","submitted":null}`),
      encode(`{${whole},"released":"2026-13-45T99:99:99Z","submitted":null}`),
      encode(`{${whole},"released":17,"submitted":null}`),
      encode(`{${whole},"released":null,"submitted":"2"}`),
      encode(`{${whole},"released":null,"submitted":1.5}`),
      // An extra key is a cursor this route did not issue.
      encode(`{${whole},"released":null,"submitted":null,"extra":true}`),
    ];
    for (const cursor of cursors) {
      const res = await app.request(
        `/admin/operations/forms?environment=prod&cursor=${encodeURIComponent(cursor)}`,
        { headers: headers(viewer.token) },
      );
      expect(res.status, cursor).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code, cursor).toBe(
        "INVALID_CURSOR",
      );
    }
  });

  it("pages a released sort in both directions, and the two orders are reverses", async () => {
    const walk = async (sort: string): Promise<string[]> => {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const query =
          cursor === null
            ? `environment=prod&limit=1&sort=${sort}`
            : `environment=prod&limit=1&sort=${sort}&cursor=${encodeURIComponent(cursor)}`;
        const result = await operations(viewer.token, query);
        expect(result.status, sort).toBe(200);
        expect(result.body.total, sort).toBe(2);
        seen.push(...result.body.forms.map((row) => row.slug));
        cursor = result.body.nextCursor;
        if (cursor === null) break;
      }
      expect(cursor, sort).toBeNull();
      return seen;
    };
    const ascending = await walk("released-asc");
    expect([...ascending].sort()).toEqual(["ops-claims", "ops-permits"]);
    const descending = await walk("released-desc");
    expect(descending).toEqual([...ascending].reverse());
  });

  it("pages non-ASCII slugs and titles without losing a row", async () => {
    const first = await operations(unicodeViewer.token, "environment=prod&limit=1&sort=slug-asc");
    expect(first.body.total).toBe(2);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await operations(
      unicodeViewer.token,
      `environment=prod&limit=1&sort=slug-asc&cursor=${encodeURIComponent(first.body.nextCursor!)}`,
    );
    expect(second.body.nextCursor).toBeNull();
    const slugs = [...first.body.forms, ...second.body.forms].map((row) => row.slug);
    expect([...slugs].sort()).toEqual(["ops-\u00fcbersicht", "ops-\u7533\u8acb"].sort());
    const names = [...first.body.forms, ...second.body.forms].map((row) => row.displayName);
    expect([...names].sort()).toEqual(
      [
        "\u00dcbersicht \u00fcber Antr\u00e4ge",
        "\u7533\u8acb\u66f8\u30d5\u30a9\u30fc\u30e0",
      ].sort(),
    );
    // The search matches a non-ASCII display name as well as a slug.
    const searched = await operations(
      unicodeViewer.token,
      `environment=prod&q=${encodeURIComponent("Antr\u00e4ge")}`,
    );
    expect(searched.body.forms.map((row) => row.slug)).toEqual(["ops-\u00fcbersicht"]);
  });

  it("caps the page size rather than serving an unbounded one", async () => {
    const res = await app.request("/admin/operations/forms?environment=prod&limit=5000", {
      headers: headers(viewer.token),
    });
    expect(res.status).toBe(400);
  });

  it("sorts on counts without showing a count the caller may not see", async () => {
    const { body } = await operations(oneFormViewer.token, "environment=prod&sort=submitted-desc");
    expect(body.forms.map((row) => row.slug)).toEqual(["ops-claims"]);
    // A caller who may count nothing still gets a total order and no counts.
    const viewerSorted = await operations(viewer.token, "environment=prod&sort=submitted-desc");
    expect(viewerSorted.body.forms.map((row) => row.slug)).toEqual(["ops-claims", "ops-permits"]);
    expect(viewerSorted.body.forms.every((row) => row.counts === null)).toBe(true);
  });

  it("writes no access-audit row for a count", async () => {
    const before = await auditCount();
    await operations(oneFormViewer.token, "environment=prod");
    expect(await auditCount()).toBe(before);
  });
});

/** How many access-audit rows exist, so "this wrote none" is a count. */
async function auditCount(): Promise<number> {
  const rows = await control.select().from(schema.accessAudit);
  return rows.length;
}

describe("the access capability projection", () => {
  async function capabilities(token: string): Promise<Record<string, boolean>> {
    const res = await app.request("/admin/me/access", { headers: headers(token) });
    expect(res.status).toBe(200);
    return ((await res.json()) as { capabilities: Record<string, boolean> }).capabilities;
  }

  it("gives a forms viewer operations and authoring, and neither of the other two", async () => {
    expect(await capabilities(viewer.token)).toEqual({
      operations: true,
      workspaces: false,
      siteConfiguration: false,
      authoring: true,
    });
  });

  it("gives an eraser operations alone: no authoring area from a response grant", async () => {
    expect(await capabilities(eraser.token)).toEqual({
      operations: true,
      workspaces: false,
      siteConfiguration: false,
      authoring: false,
    });
  });

  it("gives a workspace-only owner workspaces alone, which is why it has no operations", async () => {
    expect(await capabilities(workspaceOwner.token)).toEqual({
      operations: false,
      workspaces: true,
      siteConfiguration: false,
      authoring: false,
    });
  });

  it("gives the installation claim workspaces and site configuration and no form area", async () => {
    expect(await capabilities(installationAdmin.token)).toEqual({
      operations: false,
      workspaces: true,
      siteConfiguration: true,
      authoring: false,
    });
  });

  it("gives a caller with no grants and no claim no area at all", async () => {
    expect(await capabilities(nobody.token)).toEqual({
      operations: false,
      workspaces: false,
      siteConfiguration: false,
      authoring: false,
    });
  });

  it("agrees with the route: every caller offered operations is served it", async () => {
    // A contract offering a mode the route refuses would be a 403 the shell walks into.
    for (const [label, who] of everyPersona) {
      const offered = (await capabilities(who.token)).operations;
      const res = await app.request("/admin/operations/forms?environment=prod", {
        headers: headers(who.token),
      });
      expect(offered, `${label}: capability vs route`).toBe(res.status === 200);
    }
  });
});

describe("the candidate review", () => {
  async function review(
    token: string,
    formId: FormId,
    source: unknown,
  ): Promise<{ status: number; body: ReviewBody }> {
    const res = await app.request(`/admin/forms/${formId}/release-review`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ source }),
    });
    return { status: res.status, body: (await res.json()) as ReviewBody };
  }

  interface ReviewBody {
    workflowRevision: number | null;
    workflowSource: string;
    targets: {
      environment: string;
      currentVersion: number | null;
      closed: boolean;
      evidence: { environment: string; version: number }[];
      blockers: { code: string; requiresAnyOf: string[] }[];
      twoPerson: { applies: boolean; refusedAsAuthor: boolean };
      protected: boolean;
    }[];
  }

  it("names only the targets the caller may release into", async () => {
    const editor = await review(testEditor.token, FORM_CLAIMS, {
      kind: "version",
      version: 1,
    });
    expect(editor.status).toBe(200);
    expect(editor.body.targets.map((target) => target.environment)).toEqual(["test"]);
    expect(editor.body.workflowRevision).toBeNull();
    expect(editor.body.workflowSource).toBe("default");

    const approver = await review(prodApprover.token, FORM_CLAIMS, {
      kind: "version",
      version: 1,
    });
    expect(approver.body.targets.map((target) => target.environment)).toEqual(["prod"]);
  });

  it("reports what is serving, the evidence that satisfied prod, and the rollback case", async () => {
    const approver = await review(prodApprover.token, FORM_CLAIMS, {
      kind: "version",
      version: 1,
    });
    const prod = approver.body.targets[0];
    expect(prod?.environment).toBe("prod");
    expect(prod?.currentVersion).toBe(1);
    expect(prod?.protected).toBe(true);
    // Version 1 is released in both, so the prerequisite is satisfied and the only
    // blocker left is that it is already serving there.
    expect(prod?.evidence.map((row) => row.environment).sort()).toEqual(["prod", "test"]);
    expect(prod?.blockers.map((blocker) => blocker.code)).toEqual(["ALREADY_RELEASED"]);
  });

  it("blocks a prod target with no prior release, keeping the TEST_RELEASE_REQUIRED code", async () => {
    await insertFormVersion(control, {
      formId: FORM_CLAIMS,
      definition: emptyDef,
      compiled: emptyCompiled,
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1.0.0",
      publishedBy: prodApprover.userId,
    });
    const approver = await review(prodApprover.token, FORM_CLAIMS, {
      kind: "version",
      version: 2,
    });
    const prod = approver.body.targets[0];
    expect(prod?.evidence).toEqual([]);
    expect(prod?.blockers.map((blocker) => blocker.code)).toEqual(["TEST_RELEASE_REQUIRED"]);
    // The default revision's rule names `test` alone: a prior release in `prod` itself is
    // the rollback exception rather than a prerequisite, and is handled as one.
    expect(prod?.blockers[0]?.requiresAnyOf).toEqual(["test"]);
  });

  it("reports the two-person rule, and refuses the author before the commit does", async () => {
    await setRequireSecondApprover(control, SEED_WORKSPACE_ID, true);
    try {
      const approver = await review(prodApprover.token, FORM_CLAIMS, {
        kind: "version",
        version: 2,
      });
      const prod = approver.body.targets[0];
      expect(prod?.twoPerson.applies).toBe(true);
      // Version 2 was published by this account in the case above.
      expect(prod?.twoPerson.refusedAsAuthor).toBe(true);
      expect(prod?.blockers.map((blocker) => blocker.code)).toContain("APPROVER_IS_AUTHOR");
    } finally {
      await setRequireSecondApprover(control, SEED_WORKSPACE_ID, false);
    }
  });

  it("refuses a caller holding no release read on the form", async () => {
    const res = await app.request(`/admin/forms/${FORM_CLAIMS}/release-review`, {
      method: "POST",
      headers: headers(oneFormViewer.token),
      body: JSON.stringify({ source: { kind: "version", version: 1 } }),
    });
    expect(res.status).toBe(403);
  });

  it("writes nothing at all", async () => {
    const before = await auditCount();
    const releasesBefore = await listFormReleases(control, FORM_CLAIMS);
    await review(prodApprover.token, FORM_CLAIMS, { kind: "version", version: 1 });
    expect(await auditCount()).toBe(before);
    expect((await listFormReleases(control, FORM_CLAIMS)).length).toBe(releasesBefore.length);
  });
});
