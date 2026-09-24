/**
 * The sample-data loader's own tests (issue #994), driven against the 013
 * Testcontainers harness DB through the same exported functions `pnpm dev:seed`,
 * `pnpm dev:seed:clear` and `pnpm dev:seed:reset` run inside the seed container.
 * Requires Docker.
 *
 * Four properties, one per exit criterion, and none of them is observable without a
 * real Postgres: the arrangement of question statuses is what the library screens
 * render, the clear is a set of DELETEs against live foreign keys, and the refusal
 * exists because of a trigger. A mocked handle would assert the code's opinion of
 * itself.
 *
 *  1. seed is idempotent - a second run adds no row and publishes no second version;
 *  2. clear removes the seeded rows and leaves hand-authored ones alone;
 *  3. reset brings every question back under the id it had (R6);
 *  4. clear REFUSES while a respondent session and its answers reference the seeded
 *     form, and deletes nothing when it does.
 */

import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import {
  FormId,
  QuestionId,
  SessionId,
  parseQuestionDefinition,
  type FormDefinition,
  type QuestionRef,
} from "@roonga/qcms-core";
import {
  appendAnswer,
  createForm,
  createQuestion,
  createQuestionVersion,
  createSession,
  getForm,
  listFormVersions,
  listQuestionVersions,
  listQuestions,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ClearRefused,
  FORM_SLUG,
  clear,
  clearBlockers,
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

/** A question nobody seeded: the row every clear in this file has to leave alone. */
const HAND_AUTHORED = QuestionId.parse("q_hand_authored");
const HAND_AUTHORED_FORM = FormId.parse("frm_hand_authored");

/** A definition for the hand-authored question, kernel-parsed like any other. */
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
  await createQuestion(db, { questionId: HAND_AUTHORED, slug: "hand-authored" });
  await createQuestionVersion(db, {
    questionId: HAND_AUTHORED,
    definition: handAuthoredDefinition(),
  });
  await createForm(db, { formId: HAND_AUTHORED_FORM, slug: "hand-authored", defaultLocale: "en" });
}

/** Every question id in the library right now, sorted. */
async function libraryIds(): Promise<string[]> {
  return (await listQuestions(db)).map((row) => String(row.questionId)).sort();
}

describe("the sample-data loader against a real database", () => {
  it("seeds every fixture question and one published form over all of them", async () => {
    await seed(db);

    const { questionIds, formId } = seededIds();
    expect(questionIds.length).toBeGreaterThan(0);
    expect(await libraryIds()).toEqual([...questionIds].map(String).sort());

    // The form is published, carries the committed compiled document, and pins every
    // question the seed wrote - the whole point of issue #994, and the property a
    // stack with questions and no form did not have.
    const form = await getForm(db, formId);
    expect(form?.slug).toBe(FORM_SLUG);
    const versions = await listFormVersions(db, formId);
    expect(versions).toHaveLength(1);
    const published = versions[0];
    if (published === undefined) throw new Error("the seed published no form version");
    const definition: FormDefinition = published.definition;
    const compiled: CompiledForm = published.compiled;

    const items: QuestionRef[] = definition.steps.flatMap((step) => step.items);
    const pinned: string[] = items.map((item) => String(item.questionId));
    expect([...new Set(pinned)].sort()).toEqual(questionIds.map(String).sort());
    expect(compiled.documents).toHaveLength(definition.steps.length);

    // Every pin is a version that existed and was published when the form went out
    // (`UNPUBLISHED_QUESTION_PIN` / `DEPRECATED_PIN` are what force that ordering).
    for (const item of items) {
      const rows = await listQuestionVersions(db, item.questionId);
      expect(rows.some((row) => row.version === item.version)).toBe(true);
    }
  });

  it("arranges the three status badges the library screens exist to show", async () => {
    // `listQuestions` summarises a question by its HIGHEST version's status, so all
    // three statuses have to be the top version of SOME question or a badge is
    // unreachable from this seed. Before issue #994 `published` was.
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

    // The seeded set is gone...
    const { questionIds, formId } = seededIds();
    expect(await getForm(db, formId)).toBeUndefined();
    expect(await listFormVersions(db, formId)).toHaveLength(0);
    for (const id of questionIds) expect(await listQuestionVersions(db, id)).toHaveLength(0);

    // ...and the two rows an operator authored in this stack are exactly as they were.
    expect(await libraryIds()).toEqual([String(HAND_AUTHORED)]);
    expect((await getForm(db, HAND_AUTHORED_FORM))?.slug).toBe("hand-authored");
  });

  it("reseeds every question under the id it had (R6)", async () => {
    const { questionIds } = seededIds();

    await reset(db);

    // An id is permanent: a cleared-then-reseeded question is the same question, and
    // nothing about the reseed may read as an attempt to reuse an id for new meaning.
    expect(await libraryIds()).toEqual(
      [...questionIds.map(String), String(HAND_AUTHORED)].sort(),
    );
    const summarised = new Set((await listQuestions(db)).map((row) => row.latestStatus));
    expect(summarised).toContain("published");
    expect(summarised).toContain("deprecated");
  });

  it("refuses to clear once the seeded form has been answered, and deletes nothing", async () => {
    const { formId, questionIds } = seededIds();
    const [version] = await listFormVersions(db, formId);
    const sessionId = SessionId.parse("ses_seed_clear_guard");
    await createSession(db, {
      sessionId,
      formId,
      formVersion: version?.version ?? 1,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    // Any seeded question: the ledger stores the value as opaque JSONB and this test is
    // about the refusal, not about what a respondent typed.
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

    // The refusal is total: a half-clear that took the questions and left the form is
    // a state no code path produces, and is what this guard exists to prevent.
    expect(await getForm(db, formId)).toBeDefined();
    expect(await listFormVersions(db, formId)).toHaveLength(1);
    for (const id of questionIds) {
      expect((await listQuestionVersions(db, id)).length).toBeGreaterThan(0);
    }
  });
});
