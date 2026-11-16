import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SITE_AUDIT_KINDS } from "../schema/control/site-audit.js";
import {
  SEED_WORKSPACE_ID,
  CONTAINER_BOOT_TIMEOUT_MS,
  startTestDb,
  type TestDb,
} from "../testing/harness.js";
import {
  listAccessAudit,
  listSiteAudit,
  writeSiteAuditRow,
  writeSiteAuditWithMirror,
} from "./index.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

const AT = new Date("2026-07-20T00:00:00.000Z");

describe("the site audit writer and its mirror", () => {
  it("appends a row with no workspace and reads it back", async () => {
    await writeSiteAuditRow(testDb.db, {
      actor: "au_actor",
      subject: "au_subject",
      kind: "administrator",
      detail: "act=promote",
      occurredAt: AT,
    });

    const { rows, total } = await listSiteAudit(testDb.db, { kind: "administrator" });
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({
      actor: "au_actor",
      subject: "au_subject",
      workspaceId: null,
      kind: "administrator",
      detail: "act=promote",
    });
  });

  it("writes the site row and one workspace row per affected workspace", async () => {
    await writeSiteAuditWithMirror(
      testDb.db,
      {
        actor: "au_actor",
        subject: "au_reset",
        workspaceId: SEED_WORKSPACE_ID,
        kind: "account",
        detail: "act=reset scope=factor",
        occurredAt: new Date(AT.getTime() + 1_000),
      },
      [SEED_WORKSPACE_ID],
    );

    const site = await listSiteAudit(testDb.db, { kind: "account" });
    expect(site.rows).toHaveLength(1);
    expect(site.rows[0]?.workspaceId).toBe(SEED_WORKSPACE_ID);

    const workspace = await listAccessAudit(testDb.db, SEED_WORKSPACE_ID, { kind: "account" });
    expect(workspace.rows).toHaveLength(1);
    // The workspace audit has no `subject` column, so the mirror carries it in `detail`.
    expect(workspace.rows[0]?.detail).toBe("subject=au_reset act=reset scope=factor");
  });

  it("mirrors a library marking as the workspace audit's `setting` kind", async () => {
    await writeSiteAuditWithMirror(
      testDb.db,
      {
        actor: "au_actor",
        subject: SEED_WORKSPACE_ID,
        workspaceId: SEED_WORKSPACE_ID,
        kind: "library",
        detail: "act=mark",
        occurredAt: new Date(AT.getTime() + 2_000),
      },
      [SEED_WORKSPACE_ID],
    );

    const workspace = await listAccessAudit(testDb.db, SEED_WORKSPACE_ID, { kind: "setting" });
    expect(workspace.rows.some((row) => row.detail?.includes("act=mark"))).toBe(true);
  });

  it("refuses a kind the CHECK does not name", async () => {
    await expect(
      testDb.client.query(
        `insert into control.site_audit (actor, kind) values ('au_actor', 'read')`,
      ),
    ).rejects.toThrow(/site_audit_kind/);
  });

  it("pins the five kinds this log holds", () => {
    expect([...SITE_AUDIT_KINDS]).toEqual([
      "account",
      "administrator",
      "approval",
      "library",
      "logo",
    ]);
  });
});
