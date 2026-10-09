import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CONTAINER_BOOT_TIMEOUT_MS,
  DEFAULT_TEST_ENVIRONMENT,
  startTestDb,
  type TestDb,
} from "../testing/harness.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

/** Seed a form + published form_version so sessions/answers have valid FKs. */
async function seedForm(formId: string): Promise<void> {
  // `forms` and `form_versions` are control-plane tables and `sessions` is a data-plane
  // one; both resolve unqualified here because the harness connects on
  // `data_<env>, control` (ADR-40), which is exactly what an API pool does.
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
      `insert into sessions (session_id, form_id, form_version, access_mode, environment, expires_at)
       values ($1, $2, 1, 'anonymous', $3, now() + interval '1 day')`,
      [sessionId, formId, DEFAULT_TEST_ENVIRONMENT],
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

  it("rejects ad-hoc DELETE outside the sanctioned door (ADR-17, migration 0004)", async () => {
    const formId = "frm_answers_delete";
    const sessionId = "ses_answers_delete";
    await seedForm(formId);
    await testDb.client.query(
      `insert into sessions (session_id, form_id, form_version, access_mode, environment, expires_at)
       values ($1, $2, 1, 'anonymous', $3, now() + interval '1 day')`,
      [sessionId, formId, DEFAULT_TEST_ENVIRONMENT],
    );
    await testDb.client.query(
      `insert into answers (session_id, question_id, value) values ($1, 'q_a', '"x"'::jsonb) returning id`,
      [sessionId],
    );

    // No transaction-local guard set → the trigger rejects the DELETE.
    await expect(
      testDb.client.query(`delete from answers where session_id = $1`, [sessionId]),
    ).rejects.toThrow(/sanctioned/i);
    // The row survives.
    const survived = await testDb.client.query(`select 1 from answers where session_id = $1`, [
      sessionId,
    ]);
    expect(survived.rowCount).toBe(1);
  });

  it("permits DELETE through the sanctioned door when the guard is set", async () => {
    const formId = "frm_answers_delete_ok";
    const sessionId = "ses_answers_delete_ok";
    await seedForm(formId);
    await testDb.client.query(
      `insert into sessions (session_id, form_id, form_version, access_mode, environment, expires_at)
       values ($1, $2, 1, 'anonymous', $3, now() + interval '1 day')`,
      [sessionId, formId, DEFAULT_TEST_ENVIRONMENT],
    );
    await testDb.client.query(
      `insert into answers (session_id, question_id, value) values ($1, 'q_a', '"x"'::jsonb)`,
      [sessionId],
    );

    // The sanctioned path: open the door for the transaction, then delete.
    await testDb.client.query("begin");
    await testDb.client.query("select set_config('qcms.allow_answer_delete', 'on', true)");
    const del = await testDb.client.query(`delete from answers where session_id = $1`, [sessionId]);
    await testDb.client.query("commit");
    expect(del.rowCount).toBe(1);
  });
});

/**
 * Acceptance case 23 of `plan/repeating-groups-and-table-input.md` section 11, the
 * roster half: an UPDATE and a DELETE on `answer_group_instances` are both
 * rejected by trigger outside the erasure door (the `answers` half is the two
 * cases above). Asserted against a real Postgres, because a trigger is the one
 * kind of guard that reading the query helpers cannot prove.
 */
describe("answer_group_instances is append-only (I5, ADR-42)", () => {
  async function seedRoster(suffix: string): Promise<string> {
    const formId = `frm_roster_${suffix}`;
    const sessionId = `ses_roster_${suffix}`;
    await seedForm(formId);
    await testDb.client.query(
      // Q46's `environment` is NOT NULL and a CHECK pins it to the schema the row sits
      // in, so a raw insert names the environment this connection resolves in (ADR-40).
      `insert into sessions (session_id, form_id, form_version, access_mode, environment, expires_at)
       values ($1, $2, 1, 'anonymous', $3, now() + interval '1 day')`,
      [sessionId, formId, DEFAULT_TEST_ENVIRONMENT],
    );
    await testDb.client.query(
      `insert into answer_group_instances (session_id, group_id, instance_id, event)
       values ($1, 'grp_pax', 'ins_one', 'added')`,
      [sessionId],
    );
    return sessionId;
  }

  it("rejects UPDATE at the database level", async () => {
    const sessionId = await seedRoster("update");
    // Rewriting an `added` row into a `removed` one is exactly the shape the
    // append-only rule exists to refuse: it would leave no record that the instance
    // had ever been minted, and that record is what the table is for.
    await expect(
      testDb.client.query(
        `update answer_group_instances set event = 'removed' where session_id = $1`,
        [sessionId],
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects ad-hoc DELETE outside the sanctioned door (ADR-17, migration 0022)", async () => {
    const sessionId = await seedRoster("delete");
    await expect(
      testDb.client.query(`delete from answer_group_instances where session_id = $1`, [sessionId]),
    ).rejects.toThrow(/sanctioned/i);
    const survived = await testDb.client.query(
      `select 1 from answer_group_instances where session_id = $1`,
      [sessionId],
    );
    expect(survived.rowCount).toBe(1);
  });

  it("permits DELETE through the SAME door the answer ledger uses", async () => {
    const sessionId = await seedRoster("delete_ok");
    // The same GUC, not a second one: ADR-17 says there are two whole-session delete
    // paths and migration 0022 adds none. Had the roster been given a door of its own,
    // this test would still pass and nothing would say that erasure now has to open
    // two of them.
    await testDb.client.query("begin");
    await testDb.client.query("select set_config('qcms.allow_answer_delete', 'on', true)");
    const del = await testDb.client.query(
      `delete from answer_group_instances where session_id = $1`,
      [sessionId],
    );
    await testDb.client.query("commit");
    expect(del.rowCount).toBe(1);
  });

  it("refuses an event outside the vocabulary the CHECK pins", async () => {
    const sessionId = await seedRoster("event");
    await expect(
      testDb.client.query(
        `insert into answer_group_instances (session_id, group_id, instance_id, event)
         values ($1, 'grp_pax', 'ins_two', 'restored')`,
        [sessionId],
      ),
    ).rejects.toMatchObject({ constraint: "answer_group_instances_event" });
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
