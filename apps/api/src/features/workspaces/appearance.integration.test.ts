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
  listSiteAudit,
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
import { registerLogoTakedown, registerLogos } from "../logos/route.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { registerServeStep } from "../responses/serve-step/route.js";
import { registerAnonymousEntry } from "../responses/start-session/route.js";
import { registerWorkspaces } from "./route.js";

const TIMEOUT_MS = 30_000;
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
        registerLogoTakedown,
        registerForms,
      ],
    },
  });
  // Its own app, so the logo route is reached exactly as a respondent reaches it: the
  // channel token and no session gate at all.
  respondentApp = createApp(deps, PUBLIC_ONLY, {
    groups: { anonymous: [registerAnonymousEntry], respondent: [registerServeStep, registerLogos] },
  });
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
  await seedGrants(testDb.db, {
    userId: editor.userId,
    workspaceId: created.workspace.workspaceId,
  });
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

function slugOf(formId: FormId): string {
  return String(formId).replace("frm_appearance_", "appearance-");
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

async function startSession(formSlug: string): Promise<{
  sessionId: string;
  sessionToken: string;
  appearance: unknown;
}> {
  const res = await respondentApp.request("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-qcms-internal-token": internalToken },
    body: JSON.stringify({ formSlug }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { sessionId: string; sessionToken: string; appearance: unknown };
}

async function stepOf(sessionId: string, sessionToken: string): Promise<unknown> {
  const res = await respondentApp.request(`/sessions/${sessionId}/step`, {
    headers: {
      "x-qcms-internal-token": internalToken,
      authorization: `Bearer ${sessionToken}`,
    },
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { appearance: unknown }).appearance;
}

/** Publish the open draft and release that version to `prod`, so a respondent can start. */
async function publishAndRelease(formId: FormId): Promise<number> {
  const published = await send("POST", `/forms/${formId}/publish`);
  expect(published.status, await published.clone().text()).toBe(200);
  const { version } = (await published.json()) as { version: number };
  await insertFormRelease(testDb.db, {
    formId,
    environment: "prod",
    version,
    releasedBy: editor.userId,
  });
  return version;
}

async function settingRows(workspaceId: string): Promise<string[]> {
  const { rows } = await listAccessAudit(testDb.db, workspaceId, { kind: "setting", limit: 50 });
  return rows
    .map((row) => row.detail ?? "")
    .filter((detail) => detail.startsWith("setting=appearanceLock"));
}

describe(
  "workspace themes need Edit forms in that workspace (criterion 118)",
  { timeout: TIMEOUT_MS },
  () => {
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
      // Its own code: the serving route's 404 is `LOGO_NOT_FOUND` and this is not that.
      expect(await codeOf(res)).toBe("LOGO_UNKNOWN");
    });

    it("answers the uniform theme 404 for an id that is not a uuid, on every theme route", async () => {
      const workspaceId = await newWorkspace("themes-bad-id");
      const probes: [string, string, unknown][] = [
        ["GET", `/workspaces/${workspaceId}/themes/thm_x`, undefined],
        ["PUT", `/workspaces/${workspaceId}/themes/thm_x`, themeBody("Nope", "#1d4ed8")],
        ["DELETE", `/workspaces/${workspaceId}/themes/thm_x`, undefined],
        ["POST", `/workspaces/${workspaceId}/themes/thm_x/logo`, { bytesBase64: pngBase64(0x44) }],
      ];
      for (const [method, path, body] of probes) {
        const res = await send(method, path, body);
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(await codeOf(res)).toBe("THEME_NOT_FOUND");
      }
    });
  },
);

describe(
  "the appearance lock is a workspace setting (criterion 120)",
  { timeout: TIMEOUT_MS },
  () => {
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

      const set = await as(
        workspaceAdministrator.token,
        "PUT",
        `/workspaces/${workspaceId}/appearance-lock`,
        {
          locked: true,
        },
      );
      expect(set.status, await set.clone().text()).toBe(200);
      expect((await set.json()) as unknown).toMatchObject({ appearanceLocked: true });

      const cleared = await as(
        siteAdministrator.token,
        "PUT",
        `/workspaces/${workspaceId}/appearance-lock`,
        {
          locked: false,
        },
      );
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
      const again = await send("PUT", `/workspaces/${workspaceId}/appearance-lock`, {
        locked: true,
      });
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
  },
);

describe(
  "a locked workspace refuses every appearance change (criterion 121)",
  { timeout: TIMEOUT_MS },
  () => {
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

    it("refuses an appearance on the assistant's own draft path, locked or not (SEC-17)", async () => {
      // The proposal digest binds the form id and the definition only, so an appearance on
      // a tokened save was never on the card. It is refused until the digest binds it,
      // which is a stronger answer than the lock and does not depend on one.
      async function tokenedSave(
        formId: FormId,
        proposalId: string,
        body: Record<string, unknown>,
      ): Promise<Response> {
        const definition = definitionFor(formId);
        const args = { formId: String(formId), definition: { ...definition, formId: undefined } };
        const token = await signProposalToken(deps.config.keys.app, {
          sub: editor.userId,
          pid: proposalId,
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
        return as(
          editor.token,
          "PUT",
          `/forms/${formId}/draft`,
          { definition, ...body },
          { [PROPOSAL_HEADER]: token, [PROPOSAL_STEP_HEADER]: "0" },
        );
      }

      const locked = await lockedFormWith(appearanceFor("#1d4ed8"));
      const refused = await tokenedSave(locked.formId, "prp_locked_0001", {
        appearance: appearanceFor("#0f766e"),
      });
      expect(refused.status, await refused.clone().text()).toBe(422);
      expect(await codeOf(refused)).toBe("APPEARANCE_NOT_IN_PROPOSAL");

      // Unlocked, and still refused: the refusal is the proposal's shape, not the lock.
      const openWorkspace = await newWorkspace("agent-appearance");
      const openForm = await newForm(openWorkspace);
      const unlocked = await tokenedSave(openForm, "prp_open_0001", {
        appearance: appearanceFor("#0f766e"),
      });
      expect(unlocked.status, await unlocked.clone().text()).toBe(422);
      expect(await codeOf(unlocked)).toBe("APPEARANCE_NOT_IN_PROPOSAL");

      // Carrying none still saves, under the lock as well: that is the kind as it stands.
      const carried = await tokenedSave(locked.formId, "prp_locked_0002", {});
      expect(carried.status, await carried.clone().text()).toBe(200);
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

    it("refuses a draft logo key nothing was stored under, as the theme path does", async () => {
      const workspaceId = await newWorkspace("draft-unknown-logo");
      const formId = await newForm(workspaceId);
      const res = await send("PUT", `/forms/${formId}/draft`, {
        definition: definitionFor(formId),
        appearance: appearanceFor("#1d4ed8", "b".repeat(64)),
      });
      expect(res.status, await res.clone().text()).toBe(422);
      expect(await codeOf(res)).toBe("LOGO_UNKNOWN");
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
  },
);

describe("the logo route (criterion 122)", { timeout: TIMEOUT_MS }, () => {
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
    // Revalidated rather than immutable for a year, because a logo can be taken down.
    expect(served.headers.get("cache-control")).toBe("public, max-age=86400, must-revalidate");
    expect(served.headers.get("etag")).toBe(`"${logoKey}"`);
    // The app-wide policy, which is what is actually served: the route sets none of its
    // own, and `securityHeaders()` would overwrite one that it did.
    expect(served.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
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

    const polyglot = Buffer.concat([Buffer.from("<svg/>"), Buffer.from(PNG_SIGNATURE)]).toString(
      "base64",
    );
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

describe("appearance travels by value (criterion 124)", { timeout: TIMEOUT_MS }, () => {
  it("keeps a draft's and a version's appearance when the theme is changed and deleted", async () => {
    const workspaceId = await newWorkspace("by-value");
    const themeId = await createTheme(workspaceId, "Applied", "#1d4ed8");
    const uploaded = await uploadLogo(workspaceId, themeId, pngBase64(0x33));
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const { logoKey } = (await uploaded.json()) as { logoKey: string };

    // Read back rather than rebuilt: what a drawer would apply is the stored theme, so
    // the appearance under test is the one the route serves.
    const read = await send("GET", `/workspaces/${workspaceId}/themes/${themeId}`);
    expect(read.status, await read.clone().text()).toBe(200);
    const stored = ((await read.json()) as { theme: Record<string, unknown> }).theme;
    expect(stored["logoKey"]).toBe(logoKey);

    // Applying a theme is a draft PUT carrying its values: nothing on the draft names
    // the theme, so the theme's later life cannot reach it.
    const formId = await newForm(workspaceId);
    const applied: Appearance = {
      ...appearanceFor("#1d4ed8", logoKey),
      palettes: stored["palettes"] as Appearance["palettes"],
      face: stored["face"] as Appearance["face"],
      corners: stored["corners"] as Appearance["corners"],
      pageTint: stored["pageTint"] as boolean,
    };
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
    // Deleting a theme removes no logo; only a Site administrator takedown does.
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

  it("carries a tinted page from the theme route through the draft to the form read", async () => {
    const workspaceId = await newWorkspace("page-tint");
    const create = await send("POST", `/workspaces/${workspaceId}/themes`, {
      ...themeBody("Tinted", "#0f766e"),
      pageTint: true,
    });
    expect(create.status, await create.clone().text()).toBe(201);
    const themeId = ((await create.json()) as { theme: { themeId: string } }).theme.themeId;

    const read = await send("GET", `/workspaces/${workspaceId}/themes/${themeId}`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { theme: { pageTint: boolean } }).theme.pageTint).toBe(true);

    const formId = await newForm(workspaceId);
    const applied: Appearance = { ...appearanceFor("#0f766e"), pageTint: true };
    const saved = await send("PUT", `/forms/${formId}/draft`, {
      definition: definitionFor(formId),
      appearance: applied,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(((await saved.json()) as { appearance: Appearance }).appearance.pageTint).toBe(true);

    const detail = await send("GET", `/forms/${formId}`);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { appearance: Appearance }).appearance.pageTint).toBe(true);
  });
});

describe(
  "a respondent keeps the appearance of the version they started (A2, ADR-07)",
  { timeout: TIMEOUT_MS },
  () => {
    it("carries it on start-session and on every step, and a later version does not reach it", async () => {
      const workspaceId = await newWorkspace("respondent-appearance");
      const formId = await newForm(workspaceId);
      const first = appearanceFor("#1d4ed8");
      const savedFirst = await send("PUT", `/forms/${formId}/draft`, {
        definition: definitionFor(formId),
        appearance: first,
      });
      expect(savedFirst.status, await savedFirst.clone().text()).toBe(200);
      await publishAndRelease(formId);

      const session = await startSession(slugOf(formId));
      expect(session.appearance).toStrictEqual(first);
      expect(await stepOf(session.sessionId, session.sessionToken)).toStrictEqual(first);

      // A second version with a different appearance, released over the first.
      const second = appearanceFor("#b91c1c");
      const savedSecond = await send("PUT", `/forms/${formId}/draft`, {
        definition: definitionFor(formId),
        appearance: second,
      });
      expect(savedSecond.status, await savedSecond.clone().text()).toBe(200);
      await publishAndRelease(formId);

      // The running session is pinned, so its step still carries the first appearance.
      expect(await stepOf(session.sessionId, session.sessionToken)).toStrictEqual(first);
      // A session started now gets the second, which is what makes the pin above mean something.
      const later = await startSession(slugOf(formId));
      expect(later.appearance).toStrictEqual(second);
      expect(await stepOf(later.sessionId, later.sessionToken)).toStrictEqual(second);
    });
  },
);

describe("a Site administrator may take a stored logo down", { timeout: TIMEOUT_MS }, () => {
  async function storedLogo(label: string, fill: number): Promise<string> {
    const workspaceId = await newWorkspace(label);
    const themeId = await createTheme(workspaceId, "Takedown", "#1d4ed8");
    const uploaded = await uploadLogo(workspaceId, themeId, pngBase64(fill));
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    return ((await uploaded.json()) as { logoKey: string }).logoKey;
  }

  it("deletes the bytes, clears the theme, leaves a version's key and writes one audit row", async () => {
    const workspaceId = await newWorkspace("takedown");
    const themeId = await createTheme(workspaceId, "Takedown", "#1d4ed8");
    const uploaded = await uploadLogo(workspaceId, themeId, pngBase64(0x55));
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const { logoKey } = (await uploaded.json()) as { logoKey: string };

    const formId = await newForm(workspaceId);
    const applied = appearanceFor("#1d4ed8", logoKey);
    const saved = await send("PUT", `/forms/${formId}/draft`, {
      definition: definitionFor(formId),
      appearance: applied,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const version = await publishAndRelease(formId);
    expect((await serveLogo(logoKey)).status).toBe(200);

    const siteAdministrator = await seedAdminSession(testDb.db, {
      label: "takedown-site-admin",
      membership: false,
    });
    const takedown = await as(siteAdministrator.token, "DELETE", `/logos/${logoKey}`);
    expect(takedown.status, await takedown.clone().text()).toBe(200);
    expect((await takedown.json()) as unknown).toMatchObject({ logoKey, themesCleared: 1 });

    // The bytes are gone, so every holder of the key is served the uniform 404.
    const gone = await serveLogo(logoKey);
    expect(gone.status).toBe(404);
    expect(await codeOf(gone)).toBe("LOGO_NOT_FOUND");

    // The version is immutable, so it keeps the key it froze; the theme stops naming one.
    expect((await getFormVersion(testDb.db, formId, version))?.appearance).toStrictEqual(applied);
    const theme = await send("GET", `/workspaces/${workspaceId}/themes/${themeId}`);
    expect(
      ((await theme.json()) as { theme: { logoKey: string | null } }).theme.logoKey,
    ).toBeNull();

    const { rows } = await listSiteAudit(testDb.db, { kind: "logo", limit: 50 });
    const mine = rows.filter((row) => row.subject === logoKey);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.detail).toBe("logo=takedown themes=1");

    // The workspace whose theme lost the logo gets the mirrored row in its own audit.
    const mirrored = await listAccessAudit(testDb.db, workspaceId, { kind: "setting" });
    expect(mirrored.rows.map((row) => row.detail)).toContain(
      `subject=${logoKey} logo=takedown themes=1`,
    );

    // Taking the same key down twice is the same 404 an unknown key answers.
    const again = await as(siteAdministrator.token, "DELETE", `/logos/${logoKey}`);
    expect(again.status).toBe(404);
  });

  it("refuses a later upload of the same bytes, from any workspace", async () => {
    const workspaceId = await newWorkspace("tombstone");
    const themeId = await createTheme(workspaceId, "Tombstone", "#1d4ed8");
    const bytes = pngBase64(0x77);
    const uploaded = await uploadLogo(workspaceId, themeId, bytes);
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const { logoKey } = (await uploaded.json()) as { logoKey: string };

    const siteAdministrator = await seedAdminSession(testDb.db, {
      label: "tombstone-site-admin",
      membership: false,
    });
    const takedown = await as(siteAdministrator.token, "DELETE", `/logos/${logoKey}`);
    expect(takedown.status, await takedown.clone().text()).toBe(200);

    const elsewhere = await newWorkspace("tombstone-elsewhere");
    const otherTheme = await createTheme(elsewhere, "Elsewhere", "#1d4ed8");
    for (const [workspace, theme] of [
      [workspaceId, themeId],
      [elsewhere, otherTheme],
    ] as const) {
      const again = await uploadLogo(workspace, theme, bytes);
      expect(again.status, await again.clone().text()).toBe(409);
      expect(await codeOf(again)).toBe("LOGO_TAKEN_DOWN");
    }
    expect((await serveLogo(logoKey)).status).toBe(404);
  });

  it("mirrors one row into each workspace whose themes named the logo", async () => {
    const first = await newWorkspace("takedown-mirror-a");
    const second = await newWorkspace("takedown-mirror-b");
    const bystander = await newWorkspace("takedown-mirror-c");
    const firstTheme = await createTheme(first, "Mirror", "#1d4ed8");
    const uploaded = await uploadLogo(first, firstTheme, pngBase64(0x78));
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const { logoKey } = (await uploaded.json()) as { logoKey: string };
    for (const name of ["One", "Two"]) {
      const res = await send("POST", `/workspaces/${second}/themes`, {
        ...themeBody(name, "#1d4ed8"),
        logoKey,
      });
      expect(res.status, await res.clone().text()).toBe(201);
    }

    const siteAdministrator = await seedAdminSession(testDb.db, {
      label: "takedown-mirror-site-admin",
      membership: false,
    });
    const takedown = await as(siteAdministrator.token, "DELETE", `/logos/${logoKey}`);
    expect(takedown.status, await takedown.clone().text()).toBe(200);
    expect((await takedown.json()) as unknown).toMatchObject({ themesCleared: 3 });

    const mirroredIn = async (workspaceId: string): Promise<(string | null)[]> =>
      (await listAccessAudit(testDb.db, workspaceId, { kind: "setting" })).rows
        .filter((row) => row.detail?.startsWith(`subject=${logoKey}`) === true)
        .map((row) => row.detail);
    expect(await mirroredIn(first)).toStrictEqual([`subject=${logoKey} logo=takedown themes=3`]);
    expect(await mirroredIn(second)).toStrictEqual([`subject=${logoKey} logo=takedown themes=3`]);
    expect(await mirroredIn(bystander)).toStrictEqual([]);
  });

  /** Until the request on the pool is parked behind the open transaction's row lock. */
  async function untilBlocked(): Promise<void> {
    for (let tries = 0; tries < 200; tries += 1) {
      const waiting = await testDb.client.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
          where wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
      );
      if ((waiting.rows[0]?.n ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("the request never waited on the lock");
  }

  it("answers LOGO_UNKNOWN when a takedown commits between the logo check and a theme save", async () => {
    const workspaceId = await newWorkspace("takedown-race-theme");
    const themeId = await createTheme(workspaceId, "Race", "#1d4ed8");
    const uploaded = await uploadLogo(workspaceId, themeId, pngBase64(0x79));
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const { logoKey } = (await uploaded.json()) as { logoKey: string };
    await testDb.client.query(`update workspace_themes set logo_key = null where id = $1`, [
      themeId,
    ]);

    await testDb.client.query("begin");
    try {
      await testDb.client.query(`select control.appearance_logo_takedown($1)`, [logoKey]);
      const saving = send("PUT", `/workspaces/${workspaceId}/themes/${themeId}`, {
        ...themeBody("Race", "#1d4ed8"),
        logoKey,
      });
      await untilBlocked();
      await testDb.client.query("commit");
      const res = await saving;
      expect(res.status, await res.clone().text()).toBe(422);
      expect(await codeOf(res)).toBe("LOGO_UNKNOWN");
    } finally {
      await testDb.client.query("rollback").catch(() => undefined);
    }
  });

  it("clears again and succeeds when a theme takes the logo during the takedown", async () => {
    const workspaceId = await newWorkspace("takedown-race-delete");
    const themeId = await createTheme(workspaceId, "Race", "#1d4ed8");
    const uploaded = await uploadLogo(workspaceId, themeId, pngBase64(0x7a));
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const { logoKey } = (await uploaded.json()) as { logoKey: string };
    await testDb.client.query(`update workspace_themes set logo_key = null where id = $1`, [
      themeId,
    ]);
    const siteAdministrator = await seedAdminSession(testDb.db, {
      label: "takedown-race-site-admin",
      membership: false,
    });

    await testDb.client.query("begin");
    try {
      // The foreign key check takes a key-share lock on the logo, which the takedown's
      // delete then waits on.
      await testDb.client.query(`update workspace_themes set logo_key = $1 where id = $2`, [
        logoKey,
        themeId,
      ]);
      const takingDown = as(siteAdministrator.token, "DELETE", `/logos/${logoKey}`);
      await untilBlocked();
      await testDb.client.query("commit");
      const res = await takingDown;
      expect(res.status, await res.clone().text()).toBe(200);
      expect((await res.json()) as unknown).toMatchObject({ logoKey, themesCleared: 1 });
    } finally {
      await testDb.client.query("rollback").catch(() => undefined);
    }
    expect((await serveLogo(logoKey)).status).toBe(404);
    const theme = await send("GET", `/workspaces/${workspaceId}/themes/${themeId}`);
    expect(
      ((await theme.json()) as { theme: { logoKey: string | null } }).theme.logoKey,
    ).toBeNull();
  });

  it("refuses a Workspace administrator and an Edit forms holder", async () => {
    const logoKey = await storedLogo("takedown-refused", 0x66);
    const workspaceId = await newWorkspace("takedown-actors");
    const workspaceAdministrator = await seedAdminSession(testDb.db, {
      label: "takedown-workspace-admin",
      claim: false,
      workspaceId,
      grants: ["forms.editor"],
    });
    const onlyEditor = await seedAdminSession(testDb.db, {
      label: "takedown-editor",
      claim: false,
      owner: false,
      workspaceId,
      grants: ["forms.editor"],
    });

    for (const actor of [workspaceAdministrator, onlyEditor]) {
      const res = await as(actor.token, "DELETE", `/logos/${logoKey}`);
      expect(res.status, await res.clone().text()).toBe(403);
    }
    // Still served, so the refusals above refused the act and not just the response.
    expect((await serveLogo(logoKey)).status).toBe(200);
  });

  it("answers the serving route's uniform 404 for a malformed key", async () => {
    const siteAdministrator = await seedAdminSession(testDb.db, {
      label: "takedown-malformed",
      membership: false,
    });
    const res = await as(siteAdministrator.token, "DELETE", "/logos/not-a-key");
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe("LOGO_NOT_FOUND");
  });
});
