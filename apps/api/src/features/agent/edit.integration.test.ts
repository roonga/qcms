import {
  FormId,
  deriveAppearance,
  parseFormDefinition,
  parseQuestionDefinition,
  QuestionId,
  type Appearance,
} from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  createForm,
  createQuestion,
  createQuestionVersion,
  deleteDraft,
  insertFormVersion,
  publishQuestionVersion,
  setWorkspaceAppearanceLock,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import {
  REQUEST_ENVIRONMENT_HEADER,
  registerRequestEnvironment,
} from "../../middleware/request-environment.js";
import {
  disableSeededAccount,
  internalTokenFor,
  makeDeps,
  recordingLogger,
  seedAdminSession,
  seedGrants,
  suspendSeededGrant,
  validEnv,
} from "../../test-support.js";
import { registerForms } from "../forms/route.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { registerQuestions } from "../questions/route.js";
import { EDIT_HEADER } from "./edit-provenance.js";
import {
  EDIT_TOKEN_PURPOSE,
  EDIT_TOKEN_VERSION,
  EDIT_TTL_MS,
  EDITS_PER_TURN,
  draftStateDigest,
  mintTurnEditTokens,
  signEditToken,
  type EditOp,
} from "./edit-token.js";
import { registerAgentProvenance } from "./provenance-mount.js";
import { PROPOSAL_HEADER, PROPOSAL_STEP_HEADER } from "./provenance.js";
import { registerAgentChanges, registerFormsAssist } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const TIMEOUT_MS = 60_000;

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let owner: { token: string; userId: string };
let other: { token: string; userId: string };
let logLines: Record<string, unknown>[];

let now = new Date("2026-07-20T00:00:00.000Z");

interface Caller {
  readonly token: string;
  readonly userId: string;
}

beforeAll(async () => {
  testDb = await startTestDb();
  const recorder = recordingLogger();
  logLines = recorder.lines;
  deps = makeDeps({
    db: testDb.db,
    logger: recorder.logger,
    clock: { now: () => now },
    env: validEnv({ QCMS_FLAG_AGENT_AUTHORING: "fake" }),
  });
  app = createApp(deps, ADMIN_ONLY, {
    groups: {
      admin: [
        registerAdminAuth,
        registerRequestEnvironment,
        registerGrantCheck,
        registerAgentProvenance,
        registerQuestions,
        registerForms,
        registerFormsAssist,
        registerAgentChanges,
      ],
    },
  });
  internalToken = internalTokenFor(deps.config);
  owner = await seedAdminSession(testDb.db, { label: "edit_owner", at: now });
  other = await seedAdminSession(testDb.db, { label: "edit_other", at: now });
  const questionId = QuestionId.parse("q_edit_name");
  const parsed = parseQuestionDefinition({
    questionId: "q_edit_name",
    type: "shortText",
    label: { en: "Name" },
  });
  if (!parsed.ok) throw new Error("fixture question did not parse");
  await createQuestion(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId,
    slug: "edit-name",
  });
  await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });
  await publishQuestionVersion(testDb.db, { questionId, version: 1 });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

function definition(formId: string, title: string): Record<string, unknown> {
  return {
    formId,
    defaultLocale: "en",
    title: { en: title },
    steps: [
      {
        stepId: "stp_one",
        title: { en: "One" },
        items: [{ questionId: "q_edit_name", version: 1 }],
      },
    ],
    rules: [],
  };
}

function appearanceFor(primary: string): Appearance {
  const derived = deriveAppearance({ primary });
  return {
    palettes: derived.palettes,
    logo: null,
    face: derived.face,
    corners: "subtle",
    density: "comfortable",
    textSize: 16,
    progress: "top-indicator",
    pageTint: derived.pageTint,
  };
}

let formCounter = 0;

/** A form with no draft row and no version, so an edit applies at revision 0. */
async function bareForm(): Promise<string> {
  formCounter += 1;
  const formId = `frm_edit_${String(formCounter).padStart(3, "0")}`;
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FormId.parse(formId),
    slug: `edit-${String(formCounter)}`,
    defaultLocale: "en",
  });
  return formId;
}

/** A form with one human-saved draft, at revision 1. */
async function seededForm(): Promise<string> {
  const formId = await bareForm();
  const res = await put(owner, formId, { definition: definition(formId, "Start") });
  expect(res.status).toBe(200);
  return formId;
}

/** What a publish does to the draft: freeze the next version and delete the row. */
async function publishDraft(formId: string, title: string): Promise<void> {
  type VersionInput = Parameters<typeof insertFormVersion>[1];
  await insertFormVersion(testDb.db, {
    formId: FormId.parse(formId),
    definition: definition(formId, title) as unknown as VersionInput["definition"],
    appearance: null,
    compiled: {} as unknown as VersionInput["compiled"],
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
    publishedAt: now,
  });
  await deleteDraft(testDb.db, FormId.parse(formId));
}

function headers(caller: Caller, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: caller.token,
    [REQUEST_ENVIRONMENT_HEADER]: "test",
    ...extra,
  };
}

async function put(
  caller: Caller,
  formId: string,
  body: unknown,
  token?: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  return app.request(`/admin/forms/${formId}/draft`, {
    method: "PUT",
    headers: headers(caller, token === undefined ? extra : { ...extra, [EDIT_HEADER]: token }),
    body: JSON.stringify(body),
  });
}

interface SaveBody {
  readonly definition: Record<string, unknown>;
  readonly appearance?: Appearance;
}

/** Each edit's op and the save it produces: a title stands for `definition(formId, title)`. */
type PlannedEdit = readonly [EditOp, string | SaveBody];

async function tokens(
  caller: Caller,
  formId: string,
  planned: readonly PlannedEdit[],
  startRevision = 1,
  baseVersion = 0,
): Promise<readonly string[]> {
  const edits = await Promise.all(
    planned.map(async ([op, save]) => {
      const body = typeof save === "string" ? { definition: definition(formId, save) } : save;
      const parsed = parseFormDefinition(body.definition);
      if (!parsed.ok) throw new Error("fixture definition did not parse");
      const post = await draftStateDigest({
        definition: parsed.value,
        appearance: body.appearance ?? null,
      });
      return { op, post };
    }),
  );
  return (
    await mintTurnEditTokens(deps.config.keys.app, {
      sub: caller.userId,
      formId,
      baseVersion,
      startRevision,
      edits,
      issuedAt: now,
    })
  ).tokens;
}

async function codeOf(res: Response): Promise<string> {
  const body = (await res.json()) as { error?: { code?: string } };
  return body.error?.code ?? "";
}

async function undoTokenOf(res: Response): Promise<string> {
  const body = (await res.json()) as { agentEdit?: { undoToken: string | null } };
  const token = body.agentEdit?.undoToken;
  if (typeof token !== "string") throw new Error("the edit returned no undo token");
  return token;
}

async function rowsFor(formId: string): Promise<{ kind: string; detail: string | null }[]> {
  const result = await testDb.client.query<{ kind: string; detail: string | null }>(
    `select kind, detail from control.agent_actions where form_id = $1
       order by confirmed_at, proposal_id, step_index`,
    [formId],
  );
  return result.rows;
}

async function draftTitle(formId: string): Promise<string> {
  const result = await testDb.client.query<{ title: string }>(
    `select definition->'title'->>'en' as title from control.form_drafts where form_id = $1`,
    [formId],
  );
  return result.rows[0]?.title ?? "";
}

async function agentChanges(caller: Caller, formId: string) {
  const res = await app.request(`/admin/forms/${formId}/draft/agent-changes`, {
    headers: headers(caller),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    base: { version: number } | null;
    draft: { revision: number } | null;
    agentAssisted: boolean;
    changes: { kind: string; revision: number | null }[];
  };
}

describe("a card-less edit through the single draft save path", { timeout: TIMEOUT_MS }, () => {
  it("saves the edit, writes exactly one row and returns its undo token", async () => {
    const formId = await seededForm();
    const [token] = await tokens(owner, formId, [["copy", "Edited"]]);
    const res = await put(owner, formId, { definition: definition(formId, "Edited") }, token);
    expect(res.status).toBe(200);
    await undoTokenOf(res);
    expect(await draftTitle(formId)).toBe("Edited");
    expect(await rowsFor(formId)).toEqual([{ kind: "draft.copy", detail: "2" }]);
  });

  it("applies a turn's edits in order, one row each", async () => {
    const formId = await seededForm();
    const turn = await tokens(owner, formId, [
      ["question", "Edit 0"],
      ["step", "Edit 1"],
      ["rule", "Edit 2"],
    ]);
    for (const [index, token] of turn.entries()) {
      const res = await put(
        owner,
        formId,
        { definition: definition(formId, `Edit ${String(index)}`) },
        token,
      );
      expect(res.status).toBe(200);
    }
    expect(await rowsFor(formId)).toEqual([
      { kind: "draft.question", detail: "2" },
      { kind: "draft.step", detail: "3" },
      { kind: "draft.rule", detail: "4" },
    ]);
  });
});

describe("the injection cases (X4, A6)", { timeout: TIMEOUT_MS }, () => {
  it("refuses a forged agentAssisted mark, so neither provenance nor the wizard's read takes it", async () => {
    const formId = await seededForm();
    const res = await put(owner, formId, {
      definition: definition(formId, "Forged"),
      agentAssisted: true,
    });
    expect(res.status).toBe(400);
    expect(await rowsFor(formId)).toEqual([]);
    const read = await agentChanges(owner, formId);
    expect(read.agentAssisted).toBe(false);
    expect(read.changes).toEqual([]);
  });

  it("reports each recorded edit to the wizard, and only those", async () => {
    const formId = await seededForm();
    const [token] = await tokens(owner, formId, [["question", "Agent"]]);
    expect(
      (await put(owner, formId, { definition: definition(formId, "Agent") }, token)).status,
    ).toBe(200);
    expect(
      (await put(owner, formId, { definition: definition(formId, "Human") })).status,
    ).toBe(200);
    const read = await agentChanges(owner, formId);
    expect(read.agentAssisted).toBe(true);
    expect(read.changes).toEqual([
      expect.objectContaining({ kind: "draft.question", revision: 2 }),
    ]);
    expect(read.draft?.revision).toBe(3);
  });

  it("counts only the changes since the newest publish", async () => {
    const formId = await seededForm();
    const [early] = await tokens(owner, formId, [["copy", "A"]]);
    expect((await put(owner, formId, { definition: definition(formId, "A") }, early)).status).toBe(
      200,
    );
    type VersionInput = Parameters<typeof insertFormVersion>[1];
    now = new Date(now.getTime() + 1_000);
    await insertFormVersion(testDb.db, {
      formId: FormId.parse(formId),
      definition: definition(formId, "A") as unknown as VersionInput["definition"],
      appearance: null,
      compiled: {} as unknown as VersionInput["compiled"],
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
      publishedAt: now,
    });
    expect((await agentChanges(owner, formId)).changes).toEqual([]);

    now = new Date(now.getTime() + 1_000);
    const [late] = await tokens(owner, formId, [["rule", "B"]], 2, 1);
    expect((await put(owner, formId, { definition: definition(formId, "B") }, late)).status).toBe(
      200,
    );
    const read = await agentChanges(owner, formId);
    expect(read.base?.version).toBe(1);
    expect(read.changes.map((change) => change.kind)).toEqual(["draft.rule"]);
  });
});

describe("the edit token's bindings", { timeout: TIMEOUT_MS }, () => {
  it("refuses a token for a revision the draft has moved past", async () => {
    const formId = await seededForm();
    expect((await put(owner, formId, { definition: definition(formId, "Human") })).status).toBe(
      200,
    );
    const [stale] = await tokens(owner, formId, [["copy", "Agent"]], 1);
    const res = await put(owner, formId, { definition: definition(formId, "Agent") }, stale);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("AGENT_EDIT_REVISION");
    expect(await draftTitle(formId)).toBe("Human");
    expect(await rowsFor(formId)).toEqual([]);
  });

  it("refuses a replayed token and writes no second row", async () => {
    const formId = await seededForm();
    const [token] = await tokens(owner, formId, [["copy", "Once"]]);
    expect(
      (await put(owner, formId, { definition: definition(formId, "Once") }, token)).status,
    ).toBe(200);
    const replay = await put(owner, formId, { definition: definition(formId, "Twice") }, token);
    expect(replay.status).toBe(403);
    expect(await codeOf(replay)).toBe("AGENT_EDIT_REPLAYED");
    expect(await draftTitle(formId)).toBe("Once");
    expect(await rowsFor(formId)).toHaveLength(1);
  });

  it("refuses another user's token", async () => {
    const formId = await seededForm();
    const [theirs] = await tokens(other, formId, [["copy", "X"]]);
    const res = await put(owner, formId, { definition: definition(formId, "X") }, theirs);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("AGENT_EDIT_SUBJECT");
    expect(await rowsFor(formId)).toEqual([]);
  });

  it("refuses another form's token", async () => {
    const formId = await seededForm();
    const elsewhere = await seededForm();
    const [token] = await tokens(owner, elsewhere, [["copy", "X"]]);
    const res = await put(owner, formId, { definition: definition(formId, "X") }, token);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("AGENT_EDIT_FORM");
    expect(await rowsFor(formId)).toEqual([]);
    expect(await rowsFor(elsewhere)).toEqual([]);
  });

  it("refuses an edit over the per-turn cap", async () => {
    const formId = await seededForm();
    const iat = now.getTime();
    const overCap = await signEditToken(deps.config.keys.app, {
      v: EDIT_TOKEN_VERSION,
      purpose: EDIT_TOKEN_PURPOSE,
      act: "edit",
      sub: owner.userId,
      formId,
      tid: "edt_overcapturn01",
      n: EDITS_PER_TURN,
      base: 0,
      op: "copy",
      rev: 1,
      post: "A".repeat(43),
      iat,
      exp: iat + EDIT_TTL_MS,
    });
    const res = await put(owner, formId, { definition: definition(formId, "X") }, overCap);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("AGENT_EDIT_CAP");
    await expect(
      mintTurnEditTokens(deps.config.keys.app, {
        sub: owner.userId,
        formId,
        baseVersion: 0,
        startRevision: 1,
        edits: Array.from({ length: EDITS_PER_TURN + 1 }, () => ({
          op: "copy" as const,
          post: "A".repeat(43),
        })),
        issuedAt: now,
      }),
    ).rejects.toThrow();
  });

  it("refuses an expired token", async () => {
    const formId = await seededForm();
    const [token] = await tokens(owner, formId, [["copy", "Late"]]);
    now = new Date(now.getTime() + EDIT_TTL_MS + 1);
    try {
      const res = await put(owner, formId, { definition: definition(formId, "Late") }, token);
      expect(res.status).toBe(403);
      expect(await codeOf(res)).toBe("AGENT_EDIT_EXPIRED");
    } finally {
      now = new Date(now.getTime() - EDIT_TTL_MS - 1);
    }
  });

  it("refuses an edit whose save changes what its op does not cover", async () => {
    const formId = await seededForm();
    const [token] = await tokens(owner, formId, [["appearance", "Renamed"]]);
    const res = await put(owner, formId, { definition: definition(formId, "Renamed") }, token);
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("AGENT_EDIT_OP");
    expect(await rowsFor(formId)).toEqual([]);
  });

  it("refuses a save whose body is not the draft the edit produced, and writes no row", async () => {
    const formId = await seededForm();
    const [token] = await tokens(owner, formId, [["copy", "Proposed"]]);
    const res = await put(owner, formId, { definition: definition(formId, "Rewritten") }, token);
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("AGENT_EDIT_MISMATCH");
    expect(await draftTitle(formId)).toBe("Start");
    expect(await rowsFor(formId)).toEqual([]);
    expect(
      (await put(owner, formId, { definition: definition(formId, "Proposed") }, token)).status,
    ).toBe(200);
    expect(await rowsFor(formId)).toEqual([{ kind: "draft.copy", detail: "2" }]);
  });

  it("refuses a request carrying both a card's token and an edit token", async () => {
    const formId = await seededForm();
    const [token] = await tokens(owner, formId, [["copy", "X"]]);
    const res = await put(owner, formId, { definition: definition(formId, "X") }, token, {
      [PROPOSAL_HEADER]: "a.b",
      [PROPOSAL_STEP_HEADER]: "0",
    });
    expect(res.status).toBe(403);
    expect(await rowsFor(formId)).toEqual([]);
  });
});

describe("an edit at revision 0 and across a publish", { timeout: TIMEOUT_MS }, () => {
  it("applies a turn to a form with no draft row, starting at revision 0", async () => {
    const formId = await bareForm();
    const [first, second] = await tokens(
      owner,
      formId,
      [
        ["copy", "First"],
        ["step", "Second"],
      ],
      0,
    );
    expect(
      (await put(owner, formId, { definition: definition(formId, "First") }, first)).status,
    ).toBe(200);
    expect(
      (await put(owner, formId, { definition: definition(formId, "Second") }, second)).status,
    ).toBe(200);
    expect(await draftTitle(formId)).toBe("Second");
    expect(await rowsFor(formId)).toEqual([
      { kind: "draft.copy", detail: "1" },
      { kind: "draft.step", detail: "2" },
    ]);
  });

  it("refuses a revision-0 token once a human save has created the draft", async () => {
    const formId = await bareForm();
    const [token] = await tokens(owner, formId, [["copy", "Agent"]], 0);
    expect((await put(owner, formId, { definition: definition(formId, "Human") })).status).toBe(
      200,
    );
    const res = await put(owner, formId, { definition: definition(formId, "Agent") }, token);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("AGENT_EDIT_REVISION");
    expect(await draftTitle(formId)).toBe("Human");
    expect(await rowsFor(formId)).toEqual([]);
  });

  it("refuses a token minted before a publish once the revisions restart", async () => {
    const formId = await seededForm();
    const [stale] = await tokens(owner, formId, [["copy", "Stale"]], 1, 0);
    now = new Date(now.getTime() + 1_000);
    await publishDraft(formId, "Start");

    const [first] = await tokens(owner, formId, [["copy", "After"]], 0, 1);
    expect(
      (await put(owner, formId, { definition: definition(formId, "After") }, first)).status,
    ).toBe(200);
    const res = await put(owner, formId, { definition: definition(formId, "Stale") }, stale);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("AGENT_EDIT_REVISION");
    expect(await draftTitle(formId)).toBe("After");
    expect((await rowsFor(formId)).map((row) => row.detail)).toEqual(["1"]);
  });
});

describe("an edit's op against what its save changes", { timeout: TIMEOUT_MS }, () => {
  it("saves an appearance op that changes the appearance alone", async () => {
    const formId = await seededForm();
    const [token] = await tokens(owner, formId, [
      [
        "appearance",
        { definition: definition(formId, "Start"), appearance: appearanceFor("#1d4ed8") },
      ],
    ]);
    const res = await put(
      owner,
      formId,
      { definition: definition(formId, "Start"), appearance: appearanceFor("#1d4ed8") },
      token,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await rowsFor(formId)).toEqual([{ kind: "draft.appearance", detail: "2" }]);
  });

  it("refuses a non-appearance op whose save changes the appearance", async () => {
    const formId = await seededForm();
    for (const op of ["question", "step", "rule", "copy"] as const) {
      const [token] = await tokens(owner, formId, [
        [op, { definition: definition(formId, "Start"), appearance: appearanceFor("#0f766e") }],
      ]);
      const res = await put(
        owner,
        formId,
        { definition: definition(formId, "Start"), appearance: appearanceFor("#0f766e") },
        token,
      );
      expect(res.status, op).toBe(422);
      expect(await codeOf(res)).toBe("AGENT_EDIT_OP");
    }
    expect(await rowsFor(formId)).toEqual([]);
  });

  it("refuses an appearance op whose save changes the definition, even with an appearance", async () => {
    const formId = await seededForm();
    const [token] = await tokens(owner, formId, [
      [
        "appearance",
        { definition: definition(formId, "Renamed"), appearance: appearanceFor("#1d4ed8") },
      ],
    ]);
    const res = await put(
      owner,
      formId,
      { definition: definition(formId, "Renamed"), appearance: appearanceFor("#1d4ed8") },
      token,
    );
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("AGENT_EDIT_OP");
    expect(await draftTitle(formId)).toBe("Start");
    expect(await rowsFor(formId)).toEqual([]);
  });

  it("refuses an appearance edit on a locked workspace and writes no row", async () => {
    const formId = await seededForm();
    const [token] = await tokens(owner, formId, [
      [
        "appearance",
        { definition: definition(formId, "Start"), appearance: appearanceFor("#1d4ed8") },
      ],
    ]);
    await setWorkspaceAppearanceLock(testDb.db, SEED_WORKSPACE_ID, true);
    try {
      const res = await put(
        owner,
        formId,
        { definition: definition(formId, "Start"), appearance: appearanceFor("#1d4ed8") },
        token,
      );
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe("APPEARANCE_LOCKED");
    } finally {
      await setWorkspaceAppearanceLock(testDb.db, SEED_WORKSPACE_ID, false);
    }
    expect(await rowsFor(formId)).toEqual([]);
  });
});

describe("every edit refusal is logged by its code", { timeout: TIMEOUT_MS }, () => {
  function refusalCodesFrom(start: number): unknown[] {
    return logLines
      .slice(start)
      .filter((line) => line["msg"] === "agent edit refused")
      .map((line) => line["code"]);
  }

  it("logs the user, form, cap, route, replay, revision and op refusals", async () => {
    const formId = await seededForm();
    const elsewhere = await seededForm();
    const before = logLines.length;
    const [theirs] = await tokens(other, formId, [["copy", "X"]]);
    const [wrongForm] = await tokens(owner, elsewhere, [["copy", "X"]]);
    const iat = now.getTime();
    const overCap = await signEditToken(deps.config.keys.app, {
      v: EDIT_TOKEN_VERSION,
      purpose: EDIT_TOKEN_PURPOSE,
      act: "edit",
      sub: owner.userId,
      formId,
      tid: "edt_overcaplogged",
      n: EDITS_PER_TURN,
      base: 0,
      op: "copy",
      rev: 1,
      post: "A".repeat(43),
      iat,
      exp: iat + EDIT_TTL_MS,
    });
    const [once, stale] = await tokens(
      owner,
      formId,
      [
        ["copy", "A"],
        ["copy", "C"],
      ],
      1,
    );
    const [appearanceOp] = await tokens(owner, formId, [["appearance", "Renamed"]], 2);

    await put(owner, formId, { definition: definition(formId, "X") }, theirs);
    await put(owner, formId, { definition: definition(formId, "X") }, wrongForm);
    await put(owner, formId, { definition: definition(formId, "X") }, overCap);
    await app.request("/admin/questions", {
      method: "POST",
      headers: headers(owner, { [EDIT_HEADER]: once as string }),
      body: JSON.stringify({}),
    });
    expect((await put(owner, formId, { definition: definition(formId, "A") }, once)).status).toBe(
      200,
    );
    await put(owner, formId, { definition: definition(formId, "B") }, once);
    await put(owner, formId, { definition: definition(formId, "Renamed") }, appearanceOp);
    expect((await put(owner, formId, { definition: definition(formId, "Human") })).status).toBe(
      200,
    );
    await put(owner, formId, { definition: definition(formId, "C") }, stale);

    expect(refusalCodesFrom(before)).toEqual([
      "AGENT_EDIT_SUBJECT",
      "AGENT_EDIT_FORM",
      "AGENT_EDIT_CAP",
      "AGENT_EDIT_ROUTE",
      "AGENT_EDIT_REPLAYED",
      "AGENT_EDIT_OP",
      "AGENT_EDIT_REVISION",
    ]);
  });
});

describe("the edit route kind writes no library version (Q22)", { timeout: TIMEOUT_MS }, () => {
  async function libraryRows(): Promise<number> {
    const result = await testDb.client.query<{ n: number }>(
      `select (select count(*) from control.questions) + (select count(*) from control.question_versions) as n`,
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  it("refuses an edit token on a library route and on the assist accept", async () => {
    const formId = await seededForm();
    const [token] = await tokens(owner, formId, [["question", "X"]]);
    const before = await libraryRows();
    const create = await app.request("/admin/questions", {
      method: "POST",
      headers: headers(owner, { [EDIT_HEADER]: token as string }),
      body: JSON.stringify({
        definition: { questionId: "q_edit_smuggled", type: "shortText", label: { en: "X" } },
        slug: "edit-smuggled",
      }),
    });
    expect(create.status).toBe(403);
    expect(await codeOf(create)).toBe("AGENT_EDIT_ROUTE");
    const accept = await app.request(`/admin/forms/${formId}/draft/assist/accept`, {
      method: "POST",
      headers: headers(owner, { [EDIT_HEADER]: token as string }),
      body: JSON.stringify({
        definition: definition(formId, "X"),
        newQuestions: [
          {
            definition: { questionId: "q_edit_accepted", type: "shortText", label: { en: "X" } },
          },
        ],
      }),
    });
    expect(accept.status).toBe(403);
    expect(await codeOf(accept)).toBe("AGENT_EDIT_ROUTE");
    expect(await libraryRows()).toBe(before);
  });

  it("saves a draft naming an unknown question without creating it", async () => {
    const formId = await seededForm();
    const before = await libraryRows();
    const body = definition(formId, "Pins");
    (body["steps"] as { items: unknown[] }[])[0]?.items.push({
      questionId: "q_edit_unknown",
      version: 1,
    });
    const [token] = await tokens(owner, formId, [["question", { definition: body }]]);
    expect((await put(owner, formId, { definition: body }, token)).status).toBe(200);
    expect(await libraryRows()).toBe(before);
  });
});

describe("Undo through the same path and its own token", { timeout: TIMEOUT_MS }, () => {
  it("reverses exactly one op, latest first, one row each", async () => {
    const formId = await seededForm();
    const [first, second] = await tokens(owner, formId, [
      ["copy", "One"],
      ["copy", "Two"],
    ]);
    const undoFirst = await undoTokenOf(
      await put(owner, formId, { definition: definition(formId, "One") }, first),
    );
    const undoSecond = await undoTokenOf(
      await put(owner, formId, { definition: definition(formId, "Two") }, second),
    );

    const back = await put(owner, formId, { definition: definition(formId, "One") }, undoSecond);
    expect(back.status).toBe(200);
    expect(((await back.json()) as { agentEdit?: unknown }).agentEdit).toEqual({ undoToken: null });
    expect(await draftTitle(formId)).toBe("One");

    expect(
      (await put(owner, formId, { definition: definition(formId, "Start") }, undoFirst)).status,
    ).toBe(200);
    expect(await draftTitle(formId)).toBe("Start");
    expect((await rowsFor(formId)).map((row) => row.kind)).toEqual([
      "draft.copy",
      "draft.copy",
      "draft.undo",
      "draft.undo",
    ]);
  });

  it("refuses an Undo of an op a later edit has superseded", async () => {
    const formId = await seededForm();
    const [first, second] = await tokens(owner, formId, [
      ["copy", "One"],
      ["copy", "Two"],
    ]);
    const undoFirst = await undoTokenOf(
      await put(owner, formId, { definition: definition(formId, "One") }, first),
    );
    expect(
      (await put(owner, formId, { definition: definition(formId, "Two") }, second)).status,
    ).toBe(200);
    const res = await put(owner, formId, { definition: definition(formId, "Start") }, undoFirst);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("AGENT_UNDO_SUPERSEDED");
    expect(await draftTitle(formId)).toBe("Two");
  });

  it("refuses an Undo superseded by a human save", async () => {
    const formId = await seededForm();
    const [first] = await tokens(owner, formId, [["copy", "One"]]);
    const undo = await undoTokenOf(
      await put(owner, formId, { definition: definition(formId, "One") }, first),
    );
    expect((await put(owner, formId, { definition: definition(formId, "Human") })).status).toBe(
      200,
    );
    const res = await put(owner, formId, { definition: definition(formId, "Start") }, undo);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("AGENT_UNDO_SUPERSEDED");
  });

  it("refuses an Undo whose body is not the state before the edit, and a replayed Undo", async () => {
    const formId = await seededForm();
    const [first] = await tokens(owner, formId, [["copy", "One"]]);
    const undo = await undoTokenOf(
      await put(owner, formId, { definition: definition(formId, "One") }, first),
    );
    const wrong = await put(owner, formId, { definition: definition(formId, "Other") }, undo);
    expect(wrong.status).toBe(422);
    expect(await codeOf(wrong)).toBe("AGENT_UNDO_MISMATCH");

    expect(
      (await put(owner, formId, { definition: definition(formId, "Start") }, undo)).status,
    ).toBe(200);
    const replay = await put(owner, formId, { definition: definition(formId, "Start") }, undo);
    expect(replay.status).toBe(403);
    expect(await codeOf(replay)).toBe("AGENT_EDIT_REPLAYED");
    expect((await rowsFor(formId)).map((row) => row.kind)).toEqual(["draft.copy", "draft.undo"]);
  });

  it("refuses another user's Undo token", async () => {
    const formId = await seededForm();
    const [first] = await tokens(owner, formId, [["copy", "One"]]);
    const undo = await undoTokenOf(
      await put(owner, formId, { definition: definition(formId, "One") }, first),
    );
    const res = await put(other, formId, { definition: definition(formId, "Start") }, undo);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("AGENT_EDIT_SUBJECT");
  });
});

describe(
  "account and membership state, rechecked on every edit request",
  { timeout: TIMEOUT_MS },
  () => {
    it("refuses the next edit once the account is disabled", async () => {
      const editor = await seedAdminSession(testDb.db, { label: "edit_disabled", at: now });
      const formId = await seededForm();
      const [first, second] = await tokens(editor, formId, [
        ["copy", "One"],
        ["copy", "Two"],
      ]);
      expect(
        (await put(editor, formId, { definition: definition(formId, "One") }, first)).status,
      ).toBe(200);
      await disableSeededAccount(testDb.db, editor.userId, now);
      const res = await put(editor, formId, { definition: definition(formId, "Two") }, second);
      expect(res.status).toBe(401);
      expect(await draftTitle(formId)).toBe("One");
      expect(await rowsFor(formId)).toHaveLength(1);
    });

    it("refuses the next edit once the membership is suspended", async () => {
      const editor = await seedAdminSession(testDb.db, {
        label: "edit_suspended",
        at: now,
        membership: false,
      });
      const { teamIds } = await seedGrants(testDb.db, {
        userId: editor.userId,
        grants: ["forms.editor"],
        owner: false,
      });
      const formId = await seededForm();
      const [first, second] = await tokens(editor, formId, [
        ["copy", "One"],
        ["copy", "Two"],
      ]);
      expect(
        (await put(editor, formId, { definition: definition(formId, "One") }, first)).status,
      ).toBe(200);
      await suspendSeededGrant(testDb.db, {
        teamId: teamIds["forms.editor"] as string,
        userId: editor.userId,
        by: owner.userId,
        at: now,
      });
      const res = await put(editor, formId, { definition: definition(formId, "Two") }, second);
      expect(res.status).toBe(403);
      expect(await draftTitle(formId)).toBe("One");
      expect(await rowsFor(formId)).toHaveLength(1);
    });
  },
);
