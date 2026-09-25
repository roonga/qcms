/**
 * The sample-data loader's own tests (issue #994), driven against the 013
 * Testcontainers harness DB through the same exported functions `pnpm dev:seed`,
 * `pnpm dev:seed:clear` and `pnpm dev:seed:reset` run inside the seed container.
 * Requires Docker.
 *
 * None of what is asserted here is observable without a real Postgres: the arrangement
 * of question statuses is what the library screens render, the clear is a set of
 * DELETEs against live foreign keys, and the refusal exists because of a trigger. A
 * mocked handle would assert the code's opinion of itself.
 *
 * Two suites, each with a database of its own.
 *
 * **The lifecycle**, on a stack nobody else has written to:
 *
 *  1. seed publishes one form over every fixture question, with all three status badges;
 *  2. seed is idempotent - a second run adds no row and publishes no second version;
 *  3. clear removes the seeded rows and leaves hand-authored ones alone;
 *  4. reset brings every question back under the id it had (R6);
 *  5. clear REFUSES while a respondent session and its answers reference the seeded
 *     form, and deletes nothing when it does.
 *
 * **The derivation boundary**, on a stack an operator got to first. These are the two
 * cases issue #994's review measured against the first version of this change, where
 * `clear` deleted rows the seed had not written while printing a line that said it had
 * not, plus the publish guard that the first of them exposed:
 *
 *  6. a question authored under a corpus id before seeding stops the form publishing,
 *     and survives the clear that follows;
 *  7. a version an operator opened on a seeded question keeps the whole question.
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
  getQuestionVersion,
  listFormVersions,
  listQuestionVersions,
  listQuestions,
  questionVersions,
  questions,
} from "@roonga/qcms-db";
import { eq } from "drizzle-orm";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
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

/** Every question id in a library right now, sorted. */
async function libraryIdsIn(handle: Db): Promise<string[]> {
  return (await listQuestions(handle)).map((row) => String(row.questionId)).sort();
}

/** The lifecycle suite's own library, which is the one `db` points at. */
async function libraryIds(): Promise<string[]> {
  return libraryIdsIn(db);
}

describe("the sample-data lifecycle against a real database", () => {
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

/**
 * The derivation boundary, on its own database.
 *
 * Its own, because every case here starts from a stack an operator wrote to BEFORE the
 * seed ran, and the lifecycle suite above ends with a database that can never be cleared
 * again (an answered form, by design). Sharing one would make these depend on the order of
 * a suite whose last act is deliberately terminal.
 */
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

  /** A corpus id, authored by somebody else with their own content. */
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
    // The seed does not own the corpus ids, it only writes them when they are free.
    // `insertFormVersion` validates no pin, so without this guard the stack would end up
    // serving a snapshot that describes the fixture long-text question while the pin
    // resolves to the operator's short-text one - and, on an unpublished pin, the exact
    // state `UNPUBLISHED_QUESTION_PIN` exists to prevent.
    await createQuestion(db2, { questionId: TAKEN, slug: "medical-history" });
    await createQuestionVersion(db2, { questionId: TAKEN, definition: theirDefinition() });

    await expect(seed(db2)).rejects.toBeInstanceOf(PublishRefused);

    const { formId, questionIds } = seededIds();
    expect(
      await getForm(db2, formId),
      "no form published over content it did not write",
    ).toBeUndefined();
    // Everything it COULD do, it did: the other six questions are loaded and arranged.
    expect(await libraryIdsIn(db2)).toEqual(questionIds.map(String).sort());
    const summarised = new Set((await listQuestions(db2)).map((row) => row.latestStatus));
    expect(summarised).toContain("published");
    expect(summarised).toContain("deprecated");
  });

  it("leaves that question alone when clearing, and names it instead of reassuring", async () => {
    const outcome = await clear(db2);

    // The measured regression: this id used to be deleted here, under a printed line
    // saying hand-authored questions were still there.
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

    // And the six it did write are gone.
    expect(await libraryIdsIn(db2)).toEqual([String(TAKEN)]);
  });

  it("keeps a whole question when an operator opened a version on it", async () => {
    // Start from a stack with none of the corpus taken, so the seed publishes normally.
    await db2.delete(questionVersions).where(eq(questionVersions.questionId, TAKEN));
    await db2.delete(questions).where(eq(questions.questionId, TAKEN));
    await seed(db2);

    // An operator edits a seeded question in the admin: a third version on top of the
    // published v1 and the draft v2 the seed wrote.
    const edited = QuestionId.parse("q_full_name");
    const theirs = await getQuestionVersion(db2, edited, 1);
    if (theirs === undefined) throw new Error("the seed wrote no q_full_name");
    await createQuestionVersion(db2, { questionId: edited, definition: theirs.definition });
    expect(await listQuestionVersions(db2, edited)).toHaveLength(3);

    const outcome = await clear(db2);

    // The measured regression: those three versions used to go with the question.
    expect(await listQuestionVersions(db2, edited)).toHaveLength(3);
    expect(outcome.removed).not.toContain(String(edited));
    expect(outcome.left.map((entry) => entry.id)).toEqual([String(edited)]);
    expect(clearReportLines(outcome).join("\n")).toContain("this seed writes at most 2");
    // The form was the seed's, so it goes; only the edited question stays.
    expect(await getForm(db2, seededIds().formId)).toBeUndefined();
    expect(await libraryIdsIn(db2)).toEqual([String(edited)]);
  });
});
