import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import type { Appearance, FormDefinition } from "@roonga/qcms-core";
import { FormId, QuestionId, deriveAppearance, parseQuestionDefinition } from "@roonga/qcms-core";
import {
  LOGO_MAX_BYTES,
  createForm,
  createQuestion,
  createQuestionVersion,
  getDraft,
  getFormVersion,
  insertFormRelease,
  insertFormVersion,
  listAccessAudit,
  publishQuestionVersion,
  setRequireSecondApprover,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { registerRequestEnvironment } from "../../middleware/request-environment.js";
import {
  internalTokenFor,
  makeDeps,
  seedAdminSession,
  seedGrants,
  validEnv,
} from "../../test-support.js";
import { argumentsDigest, signProposalToken } from "../agent/proposal-token.js";
import { registerAgentProvenance } from "../agent/provenance-mount.js";
import { PROPOSAL_HEADER, PROPOSAL_STEP_HEADER } from "../agent/provenance.js";
import { registerForms } from "../forms/route.js";
import { registerLogos } from "../logos/route.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { registerWorkspaces } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let respondentApp: ReturnType<typeof createApp>;
let internalToken: string;
let editor: { token: string; userId: string };

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv({ QCMS_FLAG_AGENT_AUTHORING: "fake" }) });
  app = createApp(deps, ADMIN_ONLY, {
    groups: {
      admin: [
        registerAdminAuth,
        registerRequestEnvironment,
        registerGrantCheck,
        registerAgentProvenance,
        registerWorkspaces,
        registerForms,
      ],
    },
  });
  // Its own app, so the logo route is reached exactly as a respondent reaches it: the
  // channel token and no session gate at all.
  respondentApp = createApp(deps, PUBLIC_ONLY, { groups: { respondent: [registerLogos] } });
  internalToken = internalTokenFor(deps.config);
  editor = await seedAdminSession(testDb.db, { label: "appearance-editor" });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

function headersFor(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: token,
    ...extra,
  };
}

async function as(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<Response> {
  return app.request(`/admin${path}`, {
    method,
    headers: headersFor(token, extra),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return as(editor.token, method, path, body);
}

async function codeOf(res: Response): Promise<string> {
  const body = (await res.clone().json()) as { error?: { code?: string } };
  return body.error?.code ?? "";
}

async function detailsOf(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.clone().json()) as { error?: { details?: Record<string, unknown> } };
  return body.error?.details ?? {};
}

let workspaceCounter = 0;

/**
 * `forms.owner`, the creator's member role, holds nothing inside a workspace, so a suite
 * about Edit forms has to grant itself the authoring roles.
 */
async function newWorkspace(label: string): Promise<string> {
  workspaceCounter += 1;
  const slug = `${label}-${String(workspaceCounter)}`;
  const res = await send("POST", "/workspaces", { name: slug, slug });
  expect(res.status, await res.clone().text()).toBe(201);
  const created = (await res.json()) as { workspace: { workspaceId: string } };
  await seedGrants(testDb.db, { userId: editor.userId, workspaceId: created.workspace.workspaceId });
  return created.workspace.workspaceId;
}

const emptyCompiled = {} as unknown as CompiledForm;

let formCounter = 0;

/**
 * A publishable form: one step pinning one published question of its own workspace, so
 * the appearance under test travels through a real freeze rather than a storage door.
 */
async function newForm(workspaceId: string): Promise<FormId> {
  formCounter += 1;
  const label = String(formCounter);
  const formId = FormId.parse(`frm_appearance_${label}`);
  const questionId = QuestionId.parse(`q_appearance_${label}`);
  const parsed = parseQuestionDefinition({
    questionId: String(questionId),
    type: "shortText",
    label: { en: "Field" },
  });
  if (!parsed.ok) throw new Error("fixture question did not parse");
  await createQuestion(testDb.db, { workspaceId, questionId, slug: `appearance-q-${label}` });
  await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });
  await publishQuestionVersion(testDb.db, { questionId, version: 1 });
  await createForm(testDb.db, {
    workspaceId,
    formId,
    slug: `appearance-${label}`,
    defaultLocale: "en",
  });
  return formId;
}

function definitionFor(formId: string): FormDefinition {
  const label = String(formId).replace("frm_appearance_", "");
  return {
    formId,
    defaultLocale: "en",
    title: { en: "Appearance fixture" },
    steps: [
      {
        stepId: "stp_one",
        title: { en: "One" },
        items: [{ questionId: `q_appearance_${label}`, version: 1 }],
      },
    ],
    rules: [],
  } as unknown as FormDefinition;
}

function appearanceFor(primary: string, logo: string | null = null): Appearance {
  const derived = deriveAppearance({ primary });
  return {
    palettes: derived.palettes,
    logo,
    face: derived.face,
    corners: "subtle",
    density: "comfortable",
    textSize: 16,
    progress: "top-indicator",
    pageTint: derived.pageTint,
  };
}

function themeBody(name: string, primary: string): Record<string, unknown> {
  const derived = deriveAppearance({ primary });
  return {
    name,
    palettes: derived.palettes,
    face: derived.face,
    corners: "subtle",
    pageTint: derived.pageTint,
  };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Built rather than embedded: the sniff reads the signature, so the tail can be anything. */
function pngBase64(fill: number, tail = 64): string {
  return Buffer.concat([Buffer.from(PNG_SIGNATURE), Buffer.alloc(tail, fill)]).toString("base64");
}

async function uploadLogo(
  workspaceId: string,
  themeId: string,
  bytesBase64: string,
): Promise<Response> {
  return send("POST", `/workspaces/${workspaceId}/themes/${themeId}/logo`, { bytesBase64 });
}

async function createTheme(workspaceId: string, name: string, primary: string): Promise<string> {
  const res = await send("POST", `/workspaces/${workspaceId}/themes`, themeBody(name, primary));
  expect(res.status, await res.clone().text()).toBe(201);
  const body = (await res.json()) as { theme: { themeId: string } };
  return body.theme.themeId;
}

async function serveLogo(key: string): Promise<Response> {
  return respondentApp.request(`/logos/${key}`, {
    headers: { "x-qcms-internal-token": internalToken },
  });
}

async function settingRows(workspaceId: string): Promise<string[]> {
  const { rows } = await listAccessAudit(testDb.db, workspaceId, { kind: "setting", limit: 50 });
  return rows
    .map((row) => row.detail ?? "")
    .filter((detail) => detail.startsWith("setting=appearanceLock"));
}

describe("workspace themes need Edit forms in that workspace (criterion 118)", () => {
  it("lets an Edit forms holder save, read, list, change and delete one", async () => {
    const workspaceId = await newWorkspace("themes-crud");
    const themeId = await createTheme(workspaceId, "Harbour", "#1d4ed8");

    const read = await send("GET", `/workspaces/${workspaceId}/themes/${themeId}`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { theme: { name: string } }).theme.name).toBe("Harbour");

    const list = await send("GET", `/workspaces/${workspaceId}/themes`);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { themes: unknown[] }).themes).toHaveLength(1);

    const changed = await send(
      "PUT",
      `/workspaces/${workspaceId}/themes/${themeId}`,
      themeBody("Harbour at night", "#0f766e"),
    );
    expect(changed.status, await changed.clone().text()).toBe(200);

    const removed = await send("DELETE", `/workspaces/${workspaceId}/themes/${themeId}`);
    expect(removed.status).toBe(204);
    expect((await send("GET", `/workspaces/${workspaceId}/themes/${themeId}`)).status).toBe(404);
  });

  it("refuses a View forms holder", async () => {
    const workspaceId = await newWorkspace("themes-viewer");
    const viewer = await seedAdminSession(testDb.db, {
      label: "themes-viewer",
      claim: false,
      owner: false,
      workspaceId,
      grants: ["forms.viewer"],
    });
    const res = await as(
      viewer.token,
      "POST",
      `/workspaces/${workspaceId}/themes`,
      themeBody("Refused", "#1d4ed8"),
    );
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("FORBIDDEN");
  });

  it("refuses an Edit forms holder of another workspace", async () => {
    const mine = await newWorkspace("themes-mine");
    const theirs = await newWorkspace("themes-theirs");
    const elsewhere = await seedAdminSession(testDb.db, {
      label: "themes-elsewhere",
      claim: false,
      owner: false,
      workspaceId: theirs,
      grants: ["forms.editor"],
    });
    const res = await as(
      elsewhere.token,
      "POST",
      `/workspaces/${mine}/themes`,
      themeBody("Refused", "#1d4ed8"),
    );
    expect(res.status).toBe(403);
  });

  it("refuses a Workspace administrator and a Site administrator who hold no Edit forms", async () => {
    const workspaceId = await newWorkspace("themes-administrators");
    const workspaceAdministrator = await seedAdminSession(testDb.db, {
      label: "themes-workspace-admin",
      claim: false,
      workspaceId,
      grants: [],
    });
    const siteAdministrator = await seedAdminSession(testDb.db, {
      label: "themes-site-admin",
      membership: false,
    });

    for (const actor of [workspaceAdministrator, siteAdministrator]) {
      const res = await as(
        actor.token,
        "POST",
        `/workspaces/${workspaceId}/themes`,
        themeBody("Refused", "#1d4ed8"),
      );
      expect(res.status, await res.clone().text()).toBe(403);
    }
  });

  it("refuses palettes that fail contrast, with the correction report", async () => {
    const workspaceId = await newWorkspace("themes-contrast");
    const body = themeBody("Unreadable", "#1d4ed8") as {
      palettes: Record<string, Record<string, string>>;
    };
    const light = body.palettes["light"] as Record<string, string>;
    body.palettes["light"] = { ...light, "text-muted": "#d8d8d8" };

    const res = await send("POST", `/workspaces/${workspaceId}/themes`, body);
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("APPEARANCE_CONTRAST");
    const failures = (await detailsOf(res))["failures"] as { palette: string; ratio: number }[];
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]?.palette).toBe("light");
  });

  it("refuses a second theme with a name the workspace already uses", async () => {
    const workspaceId = await newWorkspace("themes-name");
    await createTheme(workspaceId, "Only one", "#1d4ed8");
    const again = await send(
      "POST",
      `/workspaces/${workspaceId}/themes`,
      themeBody("Only one", "#0f766e"),
    );
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("THEME_NAME_TAKEN");
  });

  it("refuses a theme naming a logo key nothing was stored under", async () => {
    const workspaceId = await newWorkspace("themes-unknown-logo");
    const res = await send("POST", `/workspaces/${workspaceId}/themes`, {
      ...themeBody("Phantom", "#1d4ed8"),
      logoKey: "b".repeat(64),
    });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("LOGO_NOT_FOUND");
  });
});

describe("the appearance lock is a workspace setting (criterion 120)", () => {
  it("is set and cleared by a Workspace administrator and by a Site administrator", async () => {
    const workspaceId = await newWorkspace("lock-administrators");
    const workspaceAdministrator = await seedAdminSession(testDb.db, {
      label: "lock-workspace-admin",
      claim: false,
      workspaceId,
      grants: [],
    });
    const siteAdministrator = await seedAdminSession(testDb.db, {
      label: "lock-site-admin",
      membership: false,
    });

    const set = await as(workspaceAdministrator.token, "PUT", `/workspaces/${workspaceId}/appearance-lock`, {
      locked: true,
    });
    expect(set.status, await set.clone().text()).toBe(200);
    expect((await set.json()) as unknown).toMatchObject({ appearanceLocked: true });

    const cleared = await as(siteAdministrator.token, "PUT", `/workspaces/${workspaceId}/appearance-lock`, {
      locked: false,
    });
    expect(cleared.status, await cleared.clone().text()).toBe(200);
    expect((await cleared.json()) as unknown).toMatchObject({ appearanceLocked: false });
  });

  it("refuses an Edit forms holder", async () => {
    const workspaceId = await newWorkspace("lock-editor");
    const onlyEditor = await seedAdminSession(testDb.db, {
      label: "lock-only-editor",
      claim: false,
      owner: false,
      workspaceId,
      grants: ["forms.editor"],
    });
    const res = await as(onlyEditor.token, "PUT", `/workspaces/${workspaceId}/appearance-lock`, {
      locked: true,
    });
    expect(res.status).toBe(403);
  });

  it("applies at once with second approval on, and writes exactly one setting row", async () => {
    const workspaceId = await newWorkspace("lock-audit");
    await setRequireSecondApprover(testDb.db, workspaceId, true);

    const set = await send("PUT", `/workspaces/${workspaceId}/appearance-lock`, { locked: true });
    expect(set.status, await set.clone().text()).toBe(200);
    expect(await settingRows(workspaceId)).toEqual(["setting=appearanceLock to=true"]);

    // A repeat changes nothing, so it records nothing: the audit holds acts, not requests.
    const again = await send("PUT", `/workspaces/${workspaceId}/appearance-lock`, { locked: true });
    expect(again.status).toBe(200);
    expect(await settingRows(workspaceId)).toHaveLength(1);

    const cleared = await send("PUT", `/workspaces/${workspaceId}/appearance-lock`, {
      locked: false,
    });
    expect(cleared.status).toBe(200);
    // Sorted, because the suite's clock is fixed: both rows carry one `occurred_at` and
    // their order is the tiebreaker's, which is not what this asserts.
    expect([...(await settingRows(workspaceId))].sort()).toEqual([
      "setting=appearanceLock to=false",
      "setting=appearanceLock to=true",
    ]);
  });
});

describe("a locked workspace refuses every appearance change (criterion 121)", () => {
  async function lockedFormWith(appearance: Appearance | null): Promise<{
    workspaceId: string;
    formId: FormId;
  }> {
    const workspaceId = await newWorkspace("locked");
    const formId = await newForm(workspaceId);
    const saved = await send("PUT", `/forms/${formId}/draft`, {
      definition: definitionFor(formId),
      ...(appearance === null ? {} : { appearance }),
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const locked = await send("PUT", `/workspaces/${workspaceId}/appearance-lock`, {
      locked: true,
    });
    expect(locked.status).toBe(200);
    return { workspaceId, formId };
  }

  it("refuses an Edit forms holder, a Workspace administrator and a Site administrator alike", async () => {
    const { workspaceId, formId } = await lockedFormWith(appearanceFor("#1d4ed8"));
    const actors = [
      editor,
      await seedAdminSession(testDb.db, {
        label: "locked-workspace-admin",
        claim: false,
        workspaceId,
        grants: ["forms.editor"],
      }),
      await seedAdminSession(testDb.db, {
        label: "locked-site-admin",
        workspaceId,
        grants: ["forms.editor"],
      }),
    ];

    for (const actor of actors) {
      const res = await as(actor.token, "PUT", `/forms/${formId}/draft`, {
        definition: definitionFor(formId),
        appearance: appearanceFor("#0f766e"),
      });
      expect(res.status, await res.clone().text()).toBe(409);
      expect(await codeOf(res)).toBe("APPEARANCE_LOCKED");
    }
  });

  it("refuses a change through the assistant's own draft path", async () => {
    const { formId } = await lockedFormWith(appearanceFor("#1d4ed8"));
    const definition = definitionFor(formId);
    const args = { formId: String(formId), definition: { ...definition, formId: undefined } };
    const token = await signProposalToken(deps.config.keys.app, {
      sub: editor.userId,
      pid: "prp_locked_0001",
      steps: [
        {
          kind: "form.saveDraft",
          argsDigest: await argumentsDigest(args),
          environment: "prod",
        },
      ],
      formId: String(formId),
      issuedAt: deps.clock.now(),
    });

    const res = await as(
      editor.token,
      "PUT",
      `/forms/${formId}/draft`,
      { definition, appearance: appearanceFor("#0f766e") },
      { [PROPOSAL_HEADER]: token, [PROPOSAL_STEP_HEADER]: "0" },
    );
    expect(res.status, await res.clone().text()).toBe(409);
    expect(await codeOf(res)).toBe("APPEARANCE_LOCKED");
  });

  it("accepts a save that changes no appearance, whether it is omitted or echoed back", async () => {
    const appearance = appearanceFor("#1d4ed8");
    const { formId } = await lockedFormWith(appearance);

    const omitted = await send("PUT", `/forms/${formId}/draft`, {
      definition: definitionFor(formId),
    });
    expect(omitted.status, await omitted.clone().text()).toBe(200);

    const echoed = await send("PUT", `/forms/${formId}/draft`, {
      definition: definitionFor(formId),
      appearance,
    });
    expect(echoed.status, await echoed.clone().text()).toBe(200);
    expect((await getDraft(testDb.db, formId))?.appearance).toStrictEqual(appearance);
  });

  it("refuses a draft appearance that fails contrast, with the correction report", async () => {
    const workspaceId = await newWorkspace("draft-contrast");
    const formId = await newForm(workspaceId);
    const appearance = appearanceFor("#1d4ed8");
    const broken = {
      ...appearance,
      palettes: {
        ...appearance.palettes,
        dark: { ...appearance.palettes.dark, "text-muted": "#2a2a2a" },
      },
    };

    const res = await send("PUT", `/forms/${formId}/draft`, {
      definition: definitionFor(formId),
      appearance: broken,
    });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("APPEARANCE_CONTRAST");
    const failures = (await detailsOf(res))["failures"] as { palette: string }[];
    expect(failures.some((failure) => failure.palette === "dark")).toBe(true);
  });

  it("refuses an appearance that is not one, before the lock is ever consulted", async () => {
    const workspaceId = await newWorkspace("draft-invalid");
    const formId = await newForm(workspaceId);
    const res = await send("PUT", `/forms/${formId}/draft`, {
      definition: definitionFor(formId),
      appearance: { face: "comicsans" },
    });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("INVALID_APPEARANCE");
  });
});

describe("the logo route (criterion 122)", () => {
  it("stores a sniffed raster and serves it with no session, a fixed type and nosniff", async () => {
    const workspaceId = await newWorkspace("logo-serve");
    const themeId = await createTheme(workspaceId, "With a logo", "#1d4ed8");

    const uploaded = await uploadLogo(workspaceId, themeId, pngBase64(0x11));
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const { logoKey, contentType } = (await uploaded.json()) as {
      logoKey: string;
      contentType: string;
    };
    expect(logoKey).toMatch(/^[0-9a-f]{64}$/u);
    expect(contentType).toBe("image/png");

    const served = await serveLogo(logoKey);
    expect(served.status, await served.clone().text()).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await served.arrayBuffer()).slice(0, 8)).toStrictEqual(
      Uint8Array.from(PNG_SIGNATURE),
    );

    // The same image twice is one row and one key: the key is the digest of the bytes.
    const twice = await uploadLogo(workspaceId, themeId, pngBase64(0x11));
    expect(twice.status).toBe(201);
    expect(((await twice.json()) as { logoKey: string }).logoKey).toBe(logoKey);
  });

  it("refuses an SVG, a polyglot and an over-cap upload", async () => {
    const workspaceId = await newWorkspace("logo-refusals");
    const themeId = await createTheme(workspaceId, "Refusals", "#1d4ed8");

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString("base64");
    const refusedSvg = await uploadLogo(workspaceId, themeId, svg);
    expect(refusedSvg.status).toBe(422);
    expect(await codeOf(refusedSvg)).toBe("LOGO_NOT_RASTER");

    const polyglot = Buffer.concat([
      Buffer.from("<svg/>"),
      Buffer.from(PNG_SIGNATURE),
    ]).toString("base64");
    const refusedPolyglot = await uploadLogo(workspaceId, themeId, polyglot);
    expect(refusedPolyglot.status).toBe(422);
    expect(await codeOf(refusedPolyglot)).toBe("LOGO_NOT_RASTER");

    const oversize = await uploadLogo(workspaceId, themeId, pngBase64(0x22, LOGO_MAX_BYTES));
    expect(oversize.status).toBe(413);
    expect(await codeOf(oversize)).toBe("LOGO_TOO_LARGE");

    const malformed = await uploadLogo(workspaceId, themeId, "not base64 at all!!");
    expect(malformed.status).toBe(400);
    expect(await codeOf(malformed)).toBe("INVALID_LOGO");
  });

  it("answers one uniform 404 for an unknown key and for a malformed one", async () => {
    for (const key of ["c".repeat(64), "not-a-key", "C".repeat(64), `${"d".repeat(63)}`]) {
      const res = await serveLogo(key);
      expect(res.status, key).toBe(404);
      expect(await codeOf(res)).toBe("LOGO_NOT_FOUND");
    }
  });
});

describe("appearance travels by value (criterion 124)", () => {
  it("keeps a draft's and a version's appearance when the theme is changed and deleted", async () => {
    const workspaceId = await newWorkspace("by-value");
    const themeId = await createTheme(workspaceId, "Applied", "#1d4ed8");
    const uploaded = await uploadLogo(workspaceId, themeId, pngBase64(0x33));
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const { logoKey } = (await uploaded.json()) as { logoKey: string };

    // Applying a theme is a draft PUT carrying its values: nothing on the draft names
    // the theme, so the theme's later life cannot reach it.
    const formId = await newForm(workspaceId);
    const applied = appearanceFor("#1d4ed8", logoKey);
    const saved = await send("PUT", `/forms/${formId}/draft`, {
      definition: definitionFor(formId),
      appearance: applied,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);

    const published = await send("POST", `/forms/${formId}/publish`);
    expect(published.status, await published.clone().text()).toBe(200);
    const { version } = (await published.json()) as { version: number };
    expect((await getFormVersion(testDb.db, formId, version))?.appearance).toStrictEqual(applied);

    // A second draft, then the lock, so the draft under test is a locked one too.
    const again = await send("PUT", `/forms/${formId}/draft`, {
      definition: definitionFor(formId),
      appearance: applied,
    });
    expect(again.status, await again.clone().text()).toBe(200);
    const locked = await send("PUT", `/workspaces/${workspaceId}/appearance-lock`, {
      locked: true,
    });
    expect(locked.status).toBe(200);

    const changed = await send(
      "PUT",
      `/workspaces/${workspaceId}/themes/${themeId}`,
      themeBody("Applied", "#b91c1c"),
    );
    expect(changed.status, await changed.clone().text()).toBe(200);
    const deleted = await send("DELETE", `/workspaces/${workspaceId}/themes/${themeId}`);
    expect(deleted.status).toBe(204);

    expect((await getDraft(testDb.db, formId))?.appearance).toStrictEqual(applied);
    expect((await getFormVersion(testDb.db, formId, version))?.appearance).toStrictEqual(applied);
    // The logo store is immutable and undeletable, so the bytes outlive the theme.
    expect((await serveLogo(logoKey)).status).toBe(200);
  });

  it("serves the pinned version's appearance to a respondent through the form read", async () => {
    const workspaceId = await newWorkspace("pinned");
    const formId = await newForm(workspaceId);
    const applied = appearanceFor("#0f766e");
    const frozen = await insertFormVersion(testDb.db, {
      formId,
      definition: definitionFor(formId),
      appearance: applied,
      compiled: emptyCompiled,
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
    });
    await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: frozen.version,
      releasedBy: editor.userId,
    });

    // No open draft, so the form read seeds from the version and reports its appearance:
    // the baseline a save echoes back under a lock.
    const read = await send("GET", `/forms/${formId}`);
    expect(read.status, await read.clone().text()).toBe(200);
    const detail = (await read.json()) as {
      draftSource: string;
      appearance: unknown;
      appearanceLocked: boolean;
    };
    expect(detail.draftSource).toBe("seeded");
    expect(detail.appearance).toStrictEqual(applied);
    expect(detail.appearanceLocked).toBe(false);
  });
});
