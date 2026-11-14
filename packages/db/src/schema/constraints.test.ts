import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CONTAINER_BOOT_TIMEOUT_MS,
  SEED_WORKSPACE_ID,
  startTestDb,
  type TestDb,
} from "../testing/harness.js";
import {
  ACCESS_AUDIT_KINDS,
  ACCESS_AUDIT_KIND_CHECK,
  APPEARANCE_LOGOS_CONTENT_TYPE_CHECK,
  APPEARANCE_LOGOS_KEY_CHECK,
  APPEARANCE_LOGOS_SIZE_CHECK,
  LOGO_MAX_BYTES,
  WORKSPACE_THEMES_CORNERS_CHECK,
} from "./index.js";

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
      `insert into forms (form_id, slug, workspace_id, default_locale)
         values ($1, 'one-draft', $2, 'en')`,
      [formId, SEED_WORKSPACE_ID],
    );

    await testDb.client.query(
      `insert into form_drafts (form_id, definition) values ($1, '{}'::jsonb)`,
      [formId],
    );

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
        `insert into forms (form_id, slug, workspace_id, default_locale)
           values ($1, $2, $3, 'en')`,
        [formId, `${formId}-slug`, SEED_WORKSPACE_ID],
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

describe("the logo store refuses anything it could not serve back (D2)", () => {
  async function storeLogo(input: {
    key: string;
    contentType: string;
    bytes: Buffer;
  }): Promise<void> {
    await testDb.client.query(
      `insert into appearance_logos (key, content_type, bytes) values ($1, $2, $3)`,
      [input.key, input.contentType, input.bytes],
    );
  }

  const png = Buffer.from("png-bytes");

  it("accepts a raster logo under the cap", async () => {
    await storeLogo({ key: "1".repeat(64), contentType: "image/png", bytes: png });
    const stored = await testDb.client.query<{ n: number }>(
      `select octet_length(bytes)::int as n from appearance_logos where key = $1`,
      ["1".repeat(64)],
    );
    expect(stored.rows[0]!.n).toBe(png.byteLength);
  });

  it("refuses a logo over the cap", async () => {
    await expect(
      storeLogo({
        key: "2".repeat(64),
        contentType: "image/png",
        bytes: Buffer.alloc(LOGO_MAX_BYTES + 1, 1),
      }),
    ).rejects.toMatchObject({ constraint: APPEARANCE_LOGOS_SIZE_CHECK });
  });

  it("refuses an unknown content type, SVG included", async () => {
    await expect(
      storeLogo({ key: "3".repeat(64), contentType: "image/svg+xml", bytes: png }),
    ).rejects.toMatchObject({ constraint: APPEARANCE_LOGOS_CONTENT_TYPE_CHECK });
  });

  it("refuses a key that is not a lowercase hex digest, so the key stays the content address", async () => {
    await expect(
      storeLogo({ key: "not-a-digest", contentType: "image/png", bytes: png }),
    ).rejects.toMatchObject({ constraint: APPEARANCE_LOGOS_KEY_CHECK });
  });
});

describe("workspace_themes pins its vocabulary and its name", () => {
  async function insertTheme(name: string, corners: string): Promise<void> {
    await testDb.client.query(
      `insert into workspace_themes (workspace_id, name, palettes, face, corners)
       values ($1, $2, '{}'::jsonb, 'system', $3)`,
      [SEED_WORKSPACE_ID, name, corners],
    );
  }

  it("refuses a corner value outside the shared module's four", async () => {
    await expect(insertTheme("Bad corners", "bevelled")).rejects.toMatchObject({
      constraint: WORKSPACE_THEMES_CORNERS_CHECK,
    });
  });

  it("refuses a second theme of the same name in one workspace", async () => {
    await insertTheme("House", "rounded");
    await expect(insertTheme("House", "sharp")).rejects.toMatchObject({ code: "23505" });
  });
});

describe("the access audit's kind CHECK carries the derive fetch (spec section 11)", () => {
  async function auditRow(kind: string): Promise<void> {
    await testDb.client.query(
      `insert into access_audit (actor, workspace_id, kind) values ('usr_a', $1, $2)`,
      [SEED_WORKSPACE_ID, kind],
    );
  }

  it("accepts every kind the module names, the theme derive fetch included", async () => {
    expect(ACCESS_AUDIT_KINDS).toContain("derive");
    for (const kind of ACCESS_AUDIT_KINDS) await auditRow(kind);
    const stored = await testDb.client.query<{ n: number }>(
      `select count(distinct kind)::int as n from access_audit where workspace_id = $1`,
      [SEED_WORKSPACE_ID],
    );
    expect(stored.rows[0]!.n).toBe(ACCESS_AUDIT_KINDS.length);
  });

  it("still refuses a kind outside the vocabulary", async () => {
    await expect(auditRow("theme-derive")).rejects.toMatchObject({
      constraint: ACCESS_AUDIT_KIND_CHECK,
    });
  });
});

/**
 * 108 is the builder's only migration, so the columns 111 writes an edit and an Undo row
 * with are confirmed here rather than added later.
 */
describe("agent_actions holds a draft edit and an Undo in its current columns (111)", () => {
  async function agentRow(proposalId: string, kind: string): Promise<void> {
    await testDb.client.query(
      `insert into agent_actions
         (proposal_id, step_index, step_count, actor, workspace_id, kind, screen, proposed_at, detail)
       values ($1, 0, 1, 'usr_a', $2, $3, 'build', now(), 'revision 4')`,
      [proposalId, SEED_WORKSPACE_ID, kind],
    );
  }

  it("takes one row per token id for an edit and for the Undo that reverses it", async () => {
    await agentRow("prp_edit_one", "form.draft.edit");
    await agentRow("prp_undo_one", "form.draft.undo");
    const stored = await testDb.client.query<{ n: number }>(
      `select count(*)::int as n from agent_actions where proposal_id in ('prp_edit_one', 'prp_undo_one')`,
    );
    expect(stored.rows[0]!.n).toBe(2);
  });

  it("refuses a replay of the same token id and step", async () => {
    await agentRow("prp_edit_two", "form.draft.edit");
    await expect(agentRow("prp_edit_two", "form.draft.edit")).rejects.toMatchObject({
      code: "23505",
    });
  });
});
