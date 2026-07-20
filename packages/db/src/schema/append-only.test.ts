import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestDb, type TestDb } from "../testing/harness.js";

const BOOT_TIMEOUT = 120_000;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
}, BOOT_TIMEOUT);

/** Seed a form + published form_version so sessions/answers have valid FKs. */
async function seedForm(formId: string): Promise<void> {
  await testDb.client.query(
    `insert into forms (form_id, slug, default_locale) values ($1, $2, 'en')`,
    [formId, `${formId}-slug`],
  );
  await testDb.client.query(
    `insert into form_versions
       (form_id, version, definition, compiled, compiler_version, a2ui_spec_version, semantics_version)
     values ($1, 1, '{}'::jsonb, '{}'::jsonb, '0.0.0', '0.0.0', '0.0.0')`,
    [formId],
  );
}

describe("answers ledger is append-only (I5, R3)", () => {
  it("rejects UPDATE at the database level", async () => {
    const formId = "frm_answers_update";
    const sessionId = "ses_answers_update";
    await seedForm(formId);
    await testDb.client.query(
      `insert into sessions (session_id, form_id, form_version, access_mode, expires_at)
       values ($1, $2, 1, 'anonymous', now() + interval '1 day')`,
      [sessionId, formId],
    );
    const inserted = await testDb.client.query<{ id: string }>(
      `insert into answers (session_id, question_id, value) values ($1, 'q_a', '"first"'::jsonb) returning id`,
      [sessionId],
    );
    const answerId = inserted.rows[0]!.id;

    await expect(
      testDb.client.query(`update answers set value = '"second"'::jsonb where id = $1`, [answerId]),
    ).rejects.toThrow(/append-only/i);
  });

  it("permits DELETE (the erasure door stays open for ADR-17)", async () => {
    const formId = "frm_answers_delete";
    const sessionId = "ses_answers_delete";
    await seedForm(formId);
    await testDb.client.query(
      `insert into sessions (session_id, form_id, form_version, access_mode, expires_at)
       values ($1, $2, 1, 'anonymous', now() + interval '1 day')`,
      [sessionId, formId],
    );
    const inserted = await testDb.client.query<{ id: string }>(
      `insert into answers (session_id, question_id, value) values ($1, 'q_a', '"x"'::jsonb) returning id`,
      [sessionId],
    );
    const answerId = inserted.rows[0]!.id;

    const del = await testDb.client.query(`delete from answers where id = $1`, [answerId]);
    expect(del.rowCount).toBe(1);
  });
});

describe("published question_versions are immutable (I1)", () => {
  async function seedQuestionVersion(questionId: string, status: string): Promise<void> {
    await testDb.client.query(`insert into questions (question_id, slug) values ($1, $2)`, [
      questionId,
      `${questionId}-slug`,
    ]);
    await testDb.client.query(
      `insert into question_versions (question_id, version, definition, status)
       values ($1, 1, '{"a":1}'::jsonb, $2)`,
      [questionId, status],
    );
  }

  it("rejects UPDATE of definition once published", async () => {
    const questionId = "q_published_freeze";
    await seedQuestionVersion(questionId, "published");
    await expect(
      testDb.client.query(
        `update question_versions set definition = '{"a":2}'::jsonb where question_id = $1`,
        [questionId],
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it("permits status transition on a published version (definition unchanged)", async () => {
    const questionId = "q_published_deprecate";
    await seedQuestionVersion(questionId, "published");
    const res = await testDb.client.query(
      `update question_versions set status = 'deprecated' where question_id = $1`,
      [questionId],
    );
    expect(res.rowCount).toBe(1);
  });

  it("permits editing a draft version's definition", async () => {
    const questionId = "q_draft_edit";
    await seedQuestionVersion(questionId, "draft");
    const res = await testDb.client.query(
      `update question_versions set definition = '{"a":99}'::jsonb where question_id = $1`,
      [questionId],
    );
    expect(res.rowCount).toBe(1);
  });
});

describe("form_versions are immutable (R1, I1)", () => {
  it("rejects every UPDATE", async () => {
    const formId = "frm_versions_immutable";
    await seedForm(formId);
    await expect(
      testDb.client.query(
        `update form_versions set compiler_version = '9.9.9' where form_id = $1`,
        [formId],
      ),
    ).rejects.toThrow(/immutable/i);
  });
});
