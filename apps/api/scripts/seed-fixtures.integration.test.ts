import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import {
  FormId,
  QuestionId,
  SessionId,
  parseQuestionDefinition,
  type FormDefinition,
  type QuestionRef,
  stepQuestionRefs,
} from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  appendAnswer,
  createForm,
  createQuestion,
  createQuestionVersion,
  createSession,
  getForm,
  getQuestionVersion,
  listFormVersions,
  listQuestionVersions,
  listQuestions,
  questionVersions,
  questions,
} from "@roonga/qcms-db";
import { eq } from "drizzle-orm";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  startTestDb,
  type TestDb,
  DEFAULT_TEST_ENVIRONMENT,
} from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ClearRefused,
  FORM_SLUG,
  PublishRefused,
  clear,
  clearBlockers,
  clearReportLines,
  reset,
  seed,
  seededIds,
  type Db,
} from "./seed-fixtures.js";

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await startTestDb();
  db = testDb.db;
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb.teardown();
});

const HAND_AUTHORED = QuestionId.parse("q_hand_authored");
const HAND_AUTHORED_FORM = FormId.parse("frm_hand_authored");

function handAuthoredDefinition() {
  const parsed = parseQuestionDefinition({
    type: "shortText",
    questionId: HAND_AUTHORED,
    label: { en: "Authored by hand in this stack" },
  });
  if (!parsed.ok) throw new Error("the hand-authored fixture did not parse");
  return parsed.value;
}

async function authorByHand(): Promise<void> {
  await createQuestion(db, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId: HAND_AUTHORED,
    slug: "hand-authored",
  });
  await createQuestionVersion(db, {
    questionId: HAND_AUTHORED,
    definition: handAuthoredDefinition(),
  });
  await createForm(db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: HAND_AUTHORED_FORM,
    slug: "hand-authored",
    defaultLocale: "en",
  });
}

async function libraryIdsIn(handle: Db): Promise<string[]> {
  return (await listQuestions(handle)).map((row) => String(row.questionId)).sort();
}

async function libraryIds(): Promise<string[]> {
  return libraryIdsIn(db);
}

describe("the sample-data lifecycle against a real database", () => {
  it("seeds every fixture question and one published form over all of them", async () => {
    await seed(db);

    const { questionIds, formId } = seededIds();
    expect(questionIds.length).toBeGreaterThan(0);
    expect(await libraryIds()).toEqual([...questionIds].map(String).sort());

    const form = await getForm(db, formId);
    expect(form?.slug).toBe(FORM_SLUG);
    const versions = await listFormVersions(db, formId);
    expect(versions).toHaveLength(1);
    const published = versions[0];
    if (published === undefined) throw new Error("the seed published no form version");
    const definition: FormDefinition = published.definition;
    const compiled: CompiledForm = published.compiled;

    const items: QuestionRef[] = definition.steps.flatMap((step) => stepQuestionRefs(step));
    const pinned: string[] = items.map((item) => String(item.questionId));
    expect([...new Set(pinned)].sort()).toEqual(questionIds.map(String).sort());
    expect(compiled.documents).toHaveLength(definition.steps.length);

    for (const item of items) {
      const rows = await listQuestionVersions(db, item.questionId);
      expect(rows.some((row) => row.version === item.version)).toBe(true);
    }
  });

  it("arranges the three status badges the library screens exist to show", async () => {
    // `listQuestions` summarises a question by its highest version's status, so each
    // status has to be the top version of some question for its badge to be reachable.
    const summarised = new Set((await listQuestions(db)).map((row) => row.latestStatus));
    expect(summarised).toEqual(new Set(["published", "draft", "deprecated"]));
  });

  it("is idempotent: a second run writes nothing and publishes no second version", async () => {
    const { formId, questionIds } = seededIds();
    const before = await Promise.all(
      questionIds.map(async (id) => [id, (await listQuestionVersions(db, id)).length] as const),
    );

    await seed(db);

    const after = await Promise.all(
      questionIds.map(async (id) => [id, (await listQuestionVersions(db, id)).length] as const),
    );
    expect(after).toEqual(before);
    expect(await listFormVersions(db, formId)).toHaveLength(1);
  });

  it("clears only what it seeded, and leaves hand-authored rows standing", async () => {
    await authorByHand();

    await clear(db);

    const { questionIds, formId } = seededIds();
    expect(await getForm(db, formId)).toBeUndefined();
    expect(await listFormVersions(db, formId)).toHaveLength(0);
    for (const id of questionIds) expect(await listQuestionVersions(db, id)).toHaveLength(0);

    expect(await libraryIds()).toEqual([String(HAND_AUTHORED)]);
    expect((await getForm(db, HAND_AUTHORED_FORM))?.slug).toBe("hand-authored");
  });

  it("reseeds every question under the id it had (R6)", async () => {
    const { questionIds } = seededIds();

    await reset(db);

    expect(await libraryIds()).toEqual([...questionIds.map(String), String(HAND_AUTHORED)].sort());
    const summarised = new Set((await listQuestions(db)).map((row) => row.latestStatus));
    expect(summarised).toContain("published");
    expect(summarised).toContain("deprecated");
  });

  it("refuses to clear once the seeded form has been answered, and deletes nothing", async () => {
    const { formId, questionIds } = seededIds();
    const [version] = await listFormVersions(db, formId);
    const sessionId = SessionId.parse("ses_seed_clear_guard");
    await createSession(db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId,
      formId,
      formVersion: version?.version ?? 1,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const answered: QuestionId | undefined = questionIds[0];
    if (answered === undefined) throw new Error("the seed wrote no questions");
    await appendAnswer(db, { sessionId, questionId: answered, value: "Answered in the portal" });

    const blockers = await clearBlockers(db, formId);
    expect(blockers.map((blocker) => blocker.what)).toEqual([
      "respondent session(s)",
      "answer ledger row(s)",
    ]);
    expect(blockers.every((blocker) => blocker.rows === 1)).toBe(true);

    await expect(clear(db)).rejects.toBeInstanceOf(ClearRefused);
    await expect(clear(db)).rejects.toThrow(/append-only/u);

    expect(await getForm(db, formId)).toBeDefined();
    expect(await listFormVersions(db, formId)).toHaveLength(1);
    for (const id of questionIds) {
      expect((await listQuestionVersions(db, id)).length).toBeGreaterThan(0);
    }
  });
});

// Its own database, because the suite above deliberately ends with an answered form, which
// can never be cleared again.
describe("the derivation boundary (issue #994 review)", () => {
  let boundaryDb: TestDb;
  let db2: Db;

  beforeAll(async () => {
    boundaryDb = await startTestDb();
    db2 = boundaryDb.db;
  }, CONTAINER_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await boundaryDb.teardown();
  });

  const TAKEN = QuestionId.parse("q_medical_history");

  function theirDefinition() {
    const parsed = parseQuestionDefinition({
      type: "shortText",
      questionId: TAKEN,
      label: { en: "Something an operator wrote under this id" },
    });
    if (!parsed.ok) throw new Error("the operator fixture did not parse");
    return parsed.value;
  }

  it("refuses to publish the form over a corpus id an operator already used", async () => {
    await createQuestion(db2, {
      workspaceId: SEED_WORKSPACE_ID,
      questionId: TAKEN,
      slug: "medical-history",
    });
    await createQuestionVersion(db2, { questionId: TAKEN, definition: theirDefinition() });

    await expect(seed(db2)).rejects.toBeInstanceOf(PublishRefused);

    const { formId, questionIds } = seededIds();
    expect(
      await getForm(db2, formId),
      "no form published over content it did not write",
    ).toBeUndefined();
    expect(await libraryIdsIn(db2)).toEqual(questionIds.map(String).sort());
    const summarised = new Set((await listQuestions(db2)).map((row) => row.latestStatus));
    expect(summarised).toContain("published");
    expect(summarised).toContain("deprecated");
  });

  it("leaves that question alone when clearing, and names it instead of reassuring", async () => {
    const outcome = await clear(db2);

    const survivor = await getQuestionVersion(db2, TAKEN, 1);
    expect(survivor?.definition).toEqual(theirDefinition());
    expect(outcome.removed).not.toContain(String(TAKEN));
    expect(outcome.removed).toHaveLength(6);
    expect(outcome.left.map((entry) => entry.id)).toEqual([String(TAKEN)]);

    const report = clearReportLines(outcome).join("\n");
    expect(report).toContain(`LEFT ALONE: ${String(TAKEN)}`);
    expect(report).toContain("not the committed fixture's content");
    expect(report, "the guarantee has to be true of what happened").not.toContain(
      "Nothing else was touched",
    );

    expect(await libraryIdsIn(db2)).toEqual([String(TAKEN)]);
  });

  it("keeps a whole question when an operator opened a version on it", async () => {
    // Start from a stack with none of the corpus taken, so the seed publishes normally.
    await db2.delete(questionVersions).where(eq(questionVersions.questionId, TAKEN));
    await db2.delete(questions).where(eq(questions.questionId, TAKEN));
    await seed(db2);

    // A third version, on top of the published v1 and the draft v2 the seed wrote.
    const edited = QuestionId.parse("q_full_name");
    const theirs = await getQuestionVersion(db2, edited, 1);
    if (theirs === undefined) throw new Error("the seed wrote no q_full_name");
    await createQuestionVersion(db2, { questionId: edited, definition: theirs.definition });
    expect(await listQuestionVersions(db2, edited)).toHaveLength(3);

    const outcome = await clear(db2);

    expect(await listQuestionVersions(db2, edited)).toHaveLength(3);
    expect(outcome.removed).not.toContain(String(edited));
    expect(outcome.left.map((entry) => entry.id)).toEqual([String(edited)]);
    expect(clearReportLines(outcome).join("\n")).toContain("this seed writes at most 2");
    expect(await getForm(db2, seededIds().formId)).toBeUndefined();
    expect(await libraryIdsIn(db2)).toEqual([String(edited)]);
  });
});
