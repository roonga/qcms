import {
  FormId,
  parseFormDefinition,
  parseQuestionDefinition,
  QuestionId,
} from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  createForm,
  createQuestion,
  createQuestionVersion,
  insertFormVersion,
  publishQuestionVersion,
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
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { registerForms } from "../forms/route.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { EDIT_HEADER } from "./edit-provenance.js";
import { draftStateDigest, mintTurnEditTokens } from "./edit-token.js";
import { registerAgentProvenance } from "./provenance-mount.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const RACERS = 8;
const ROUNDS = 5;
const TIMEOUT_MS = 120_000;

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let owner: { token: string; userId: string };
const now = new Date("2026-07-20T00:00:00.000Z");

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({
    db: testDb.db,
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
        registerForms,
      ],
    },
  });
  internalToken = internalTokenFor(deps.config);
  owner = await seedAdminSession(testDb.db, { label: "race_owner", at: now });
  const questionId = QuestionId.parse("q_race_name");
  const parsed = parseQuestionDefinition({
    questionId: "q_race_name",
    type: "shortText",
    label: { en: "Name" },
  });
  if (!parsed.ok) throw new Error("fixture question did not parse");
  await createQuestion(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId,
    slug: "race-name",
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
        items: [{ questionId: "q_race_name", version: 1 }],
      },
    ],
    rules: [],
  };
}

let formCounter = 0;

/** A form with no draft row, or with one human-saved draft at revision 1. */
async function newForm(seeded: boolean): Promise<string> {
  formCounter += 1;
  const formId = `frm_race_${String(formCounter).padStart(3, "0")}`;
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FormId.parse(formId),
    slug: `race-${String(formCounter)}`,
    defaultLocale: "en",
  });
  if (seeded) expect((await put(formId, "Start")).status).toBe(200);
  return formId;
}

function put(formId: string, title: string, token?: string): Promise<Response> {
  return Promise.resolve(
    app.request(`/admin/forms/${formId}/draft`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalToken,
        [ADMIN_SESSION_HEADER]: owner.token,
        [REQUEST_ENVIRONMENT_HEADER]: "test",
        ...(token === undefined ? {} : { [EDIT_HEADER]: token }),
      },
      body: JSON.stringify({ definition: definition(formId, title) }),
    }),
  );
}

/** One token from its own turn, so racing tokens never share an audit row key. */
async function mint(formId: string, startRevision: number, title: string): Promise<string> {
  const parsed = parseFormDefinition(definition(formId, title));
  if (!parsed.ok) throw new Error("fixture definition did not parse");
  const { tokens } = await mintTurnEditTokens(deps.config.keys.app, {
    sub: owner.userId,
    formId,
    baseVersion: 0,
    startRevision,
    edits: [
      {
        op: "copy",
        post: await draftStateDigest({ definition: parsed.value, appearance: null }),
      },
    ],
    issuedAt: now,
  });
  return tokens[0] as string;
}

async function outcome(res: Response): Promise<string> {
  if (res.status === 200) return "200";
  const body = (await res.json()) as { error?: { code?: string } };
  return `${String(res.status)}:${body.error?.code ?? ""}`;
}

async function rowDetails(formId: string): Promise<(string | null)[]> {
  const result = await testDb.client.query<{ detail: string | null }>(
    "select detail from control.agent_actions where form_id = $1 order by detail",
    [formId],
  );
  return result.rows.map((row) => row.detail);
}

async function revisionOf(formId: string): Promise<number> {
  const result = await testDb.client.query<{ revision: number }>(
    "select revision from control.form_drafts where form_id = $1",
    [formId],
  );
  return result.rows[0]?.revision ?? 0;
}

function times<T>(n: number, make: (index: number) => T): T[] {
  return Array.from({ length: n }, (_unused, index) => make(index));
}

describe("concurrent edits bind the revision they were minted for", { timeout: TIMEOUT_MS }, () => {
  for (const seeded of [false, true]) {
    const start = seeded ? 1 : 0;
    const label = seeded ? "with a draft row" : "with no draft row";

    it(`lands exactly one of ${String(RACERS)} distinct revision-${String(start)} tokens, ${label}`, async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const formId = await newForm(seeded);
        const tokens = await Promise.all(
          times(RACERS, (index) => mint(formId, start, `T${String(index)}`)),
        );
        const responses = await Promise.all(
          tokens.map((token, index) => put(formId, `T${String(index)}`, token)),
        );
        const outcomes = (await Promise.all(responses.map(outcome))).sort();
        expect(outcomes, `round ${String(round)}`).toEqual([
          "200",
          ...times(RACERS - 1, () => "409:AGENT_EDIT_REVISION"),
        ]);
        expect(await revisionOf(formId)).toBe(start + 1);
        expect(await rowDetails(formId)).toEqual([String(start + 1)]);
      }
    });

    it(`refuses a revision-${String(start)} token racing plain saves unless it lands first, ${label}`, async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const formId = await newForm(seeded);
        const token = await mint(formId, start, "Agent");
        const responses = await Promise.all([
          ...times(RACERS - 1, (index) => put(formId, `H${String(index)}`)),
          put(formId, "Agent", token),
        ]);
        const tokened = responses[RACERS - 1] as Response;
        for (const human of responses.slice(0, RACERS - 1)) expect(human.status).toBe(200);
        const result = await outcome(tokened);
        if (result === "200") {
          expect(await rowDetails(formId), `round ${String(round)}`).toEqual([String(start + 1)]);
        } else {
          expect(result, `round ${String(round)}`).toBe("409:AGENT_EDIT_REVISION");
          expect(await rowDetails(formId)).toEqual([]);
        }
        expect(await revisionOf(formId)).toBe(start + RACERS - (result === "200" ? 0 : 1));
      }
    });

    it(`lands one token replayed ${String(RACERS)} times once, ${label}`, async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const formId = await newForm(seeded);
        const token = await mint(formId, start, "Replay");
        const responses = await Promise.all(times(RACERS, () => put(formId, "Replay", token)));
        const outcomes = await Promise.all(responses.map(outcome));
        expect(
          outcomes.filter((result) => result === "200"),
          `round ${String(round)}`,
        ).toEqual(["200"]);
        // A loser that read before the winner committed waits on the draft and finds it moved.
        for (const result of outcomes.filter((entry) => entry !== "200")) {
          expect(["403:AGENT_EDIT_REPLAYED", "409:AGENT_EDIT_REVISION"]).toContain(result);
        }
        expect(await rowDetails(formId)).toEqual([String(start + 1)]);
      }
    });
  }
});

type VersionInput = Parameters<typeof insertFormVersion>[1];

async function publishVersion(formId: string): Promise<void> {
  await insertFormVersion(testDb.db, {
    formId: FormId.parse(formId),
    definition: definition(formId, "Published") as unknown as VersionInput["definition"],
    appearance: null,
    compiled: {} as unknown as VersionInput["compiled"],
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
    publishedAt: now,
  });
}

/** Holds a tokened save between its reads and its upsert while `between` runs. */
async function stalled(
  formId: string,
  token: string | undefined,
  between: () => Promise<void>,
  title = "Agent",
) {
  await testDb.client.query("begin");
  try {
    await testDb.client.query("lock table control.form_drafts in share row exclusive mode");
    const pending = put(formId, title, token);
    let waiting = 0;
    for (let i = 0; i < 400 && waiting === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const result = await testDb.client.query<{ n: number }>(
        "select count(*)::int as n from pg_locks l join pg_class c on c.oid = l.relation where c.relname = 'form_drafts' and not l.granted",
      );
      waiting = result.rows[0]?.n ?? 0;
    }
    expect(waiting).toBe(1);
    await between();
    await testDb.client.query("commit");
    return await pending;
  } catch (error) {
    await testDb.client.query("rollback");
    throw error;
  }
}

describe("an edit binds the published version it was minted for", { timeout: TIMEOUT_MS }, () => {
  for (const seeded of [false, true]) {
    it(`refuses a token when a version lands between its reads and its write, ${seeded ? "with" : "with no"} draft row`, async () => {
      const formId = await newForm(seeded);
      const token = await mint(formId, seeded ? 1 : 0, "Agent");
      const res = await stalled(formId, token, () => publishVersion(formId));
      expect(await outcome(res)).toBe("409:AGENT_EDIT_REVISION");
      expect(await rowDetails(formId)).toEqual([]);
      expect(await revisionOf(formId)).toBe(seeded ? 1 : 0);
    });
  }
});

async function rowKinds(formId: string): Promise<string[]> {
  const result = await testDb.client.query<{ kind: string }>(
    "select kind from control.agent_actions where form_id = $1 order by kind",
    [formId],
  );
  return result.rows.map((row) => row.kind);
}

async function undoTokenAfterEdit(formId: string): Promise<string> {
  const edited = await put(formId, "Agent", await mint(formId, 1, "Agent"));
  const body = (await edited.json()) as { agentEdit?: { undoToken?: string } };
  const undoToken = body.agentEdit?.undoToken;
  if (undoToken === undefined) throw new Error("edit returned no undo token");
  return undoToken;
}

describe("an undo binds the published version it was minted for", { timeout: TIMEOUT_MS }, () => {
  it("refuses an undo when a version lands between its reads and its write", async () => {
    const formId = await newForm(true);
    const undoToken = await undoTokenAfterEdit(formId);
    const rowsBefore = await rowKinds(formId);
    const res = await stalled(formId, undoToken, () => publishVersion(formId), "Start");
    expect(await outcome(res)).toBe("409:AGENT_UNDO_SUPERSEDED");
    expect(await rowKinds(formId)).toEqual(rowsBefore);
    expect(await revisionOf(formId)).toBe(2);
  });

  it("applies an undo when nothing lands in between", async () => {
    const formId = await newForm(true);
    const undoToken = await undoTokenAfterEdit(formId);
    const res = await stalled(formId, undoToken, async () => {}, "Start");
    expect(await outcome(res)).toBe("200");
    expect(await rowKinds(formId)).toContain("draft.undo");
    expect(await revisionOf(formId)).toBe(3);
  });

  it("does not refuse a plain save when a version lands between its reads and its write", async () => {
    const formId = await newForm(true);
    const res = await stalled(formId, undefined, () => publishVersion(formId), "Human");
    expect(await outcome(res)).toBe("200");
    expect(await rowKinds(formId)).toEqual([]);
  });
});
