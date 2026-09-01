import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "../testing/harness.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("form_drafts enforces at most one open draft per form", () => {
  it("rejects a second draft for the same form", async () => {
    const formId = "frm_one_draft";
    await testDb.client.query(
      `insert into forms (form_id, slug, default_locale) values ($1, 'one-draft', 'en')`,
      [formId],
    );

    // First open draft: fine.
    await testDb.client.query(
      `insert into form_drafts (form_id, definition) values ($1, '{}'::jsonb)`,
      [formId],
    );

    // Second draft for the same form: primary-key collision on form_id.
    await expect(
      testDb.client.query(
        `insert into form_drafts (form_id, definition) values ($1, '{}'::jsonb)`,
        [formId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("allows independent drafts for different forms", async () => {
    for (const formId of ["frm_draft_a", "frm_draft_b"]) {
      await testDb.client.query(
        `insert into forms (form_id, slug, default_locale) values ($1, $2, 'en')`,
        [formId, `${formId}-slug`],
      );
      await testDb.client.query(
        `insert into form_drafts (form_id, definition) values ($1, '{}'::jsonb)`,
        [formId],
      );
    }
    const res = await testDb.client.query<{ n: number }>(
      `select count(*)::int as n from form_drafts where form_id in ('frm_draft_a', 'frm_draft_b')`,
    );
    expect(res.rows[0]!.n).toBe(2);
  });
});
