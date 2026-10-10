import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import { FormId } from "@roonga/qcms-core";
import type { FormDefinition } from "@roonga/qcms-core";

import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "../testing/harness.js";
import {
  createForm,
  getReleasedVersion,
  insertFormRelease,
  insertFormVersion,
  listCurrentReleases,
  listFormReleases,
  listReleasedVersions,
} from "./index.js";

/**
 * The release record against a real Postgres (task 065, ADR-40).
 *
 * Real Postgres rather than a fake, because everything asserted below is a property of
 * SQL: whether the sequence a concurrent release gets is unique, whether a window
 * function reaches the previous release of the same environment and not of another,
 * whether `distinct on` picks the newest row per pair, and whether the append-only
 * triggers reject an UPDATE and a DELETE. The grants that decide who may write a release
 * row are a different question and are asserted in
 * `apps/api/e2e/security/03-db-least-privilege.e2e.ts`, which connects as the real roles.
 */

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as CompiledForm;

/**
 * The constraint a statement was refused by.
 *
 * Drizzle wraps a driver error in one of its own whose message is the whole failed query,
 * so the constraint name is on the `cause` rather than in the message. Reading the name
 * is what makes these assertions about the guard that fired rather than about the fact
 * that something went wrong, which is the distinction `migrations.test.ts` draws the same
 * way.
 */
async function refusedBy(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { constraint?: string }; constraint?: string }).cause;
    return cause?.constraint ?? (error as { constraint?: string }).constraint;
  }
  throw new Error("expected the statement to be refused");
}

/** A form with `versions` published versions, so a release has something to name. */
async function seedForm(label: string, versions = 1): Promise<FormId> {
  const formId = FormId.parse(`frm_${label}`);
  await createForm(testDb.db, { formId, slug: `${label}-slug`, defaultLocale: "en" });
  for (let i = 0; i < versions; i += 1) {
    await insertFormVersion(testDb.db, {
      formId,
      definition: emptyDef,
      compiled: emptyCompiled,
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
    });
  }
  return formId;
}

describe("a release is a record and never a copy (criterion 2)", () => {
  it("writes a row whose form id and version number are the published ones", async () => {
    const formId = await seedForm("promote", 2);
    const release = await insertFormRelease(testDb.db, {
      formId,
      environment: "test",
      version: 2,
      releasedBy: "usr_alice",
    });

    expect(release.formId).toBe(formId);
    expect(release.version).toBe(2);
    expect(release.sequence).toBe(1);
    expect(release.fromEnvironment).toBeNull();
    // Nothing was copied: there is still one version row per publish, and promotion to a
    // second environment adds a release row rather than a version.
    const promoted = await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 2,
      releasedBy: "usr_alice",
      fromEnvironment: "test",
    });
    expect(promoted.version).toBe(2);
    expect(promoted.fromEnvironment).toBe("test");
    const versions = await testDb.client.query(
      `select count(*)::int as n from control.form_versions where form_id = $1`,
      [formId],
    );
    expect((versions.rows[0] as { n: number }).n).toBe(2);
  });

  it("numbers each environment's history independently", async () => {
    const formId = await seedForm("sequence", 3);
    await insertFormRelease(testDb.db, {
      formId,
      environment: "test",
      version: 1,
      releasedBy: "usr_alice",
    });
    const second = await insertFormRelease(testDb.db, {
      formId,
      environment: "test",
      version: 2,
      releasedBy: "usr_alice",
    });
    const firstInProd = await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 2,
      releasedBy: "usr_alice",
      fromEnvironment: "test",
    });

    expect(second.sequence).toBe(2);
    // `prod` starts at 1 whatever `test` has done, because the sequence is the form's
    // place in THIS environment's history and is what "the newest row for the pair"
    // means.
    expect(firstInProd.sequence).toBe(1);
  });

  it("refuses a release of a version that was never published", async () => {
    const formId = await seedForm("unpublished", 1);
    expect(
      await refusedBy(() =>
        insertFormRelease(testDb.db, {
          formId,
          environment: "test",
          version: 9,
          releasedBy: "usr_alice",
        }),
      ),
    ).toBe("form_releases_form_version_fk");
  });

  it("refuses an environment that is not in the live set", async () => {
    const formId = await seedForm("unknownenv", 1);
    expect(
      await refusedBy(() =>
        insertFormRelease(testDb.db, {
          formId,
          environment: "staging",
          version: 1,
          releasedBy: "usr_alice",
        }),
      ),
    ).toBe("form_releases_environment_fk");
  });

  it("refuses a promotion whose source is the environment it releases to", async () => {
    const formId = await seedForm("selfsource", 1);
    expect(
      await refusedBy(() =>
        insertFormRelease(testDb.db, {
          formId,
          environment: "test",
          version: 1,
          releasedBy: "usr_alice",
          fromEnvironment: "test",
        }),
      ),
    ).toBe("form_releases_from_other_environment");
  });
});

describe("what is released where (criteria 1 and 5)", () => {
  it("answers per environment, and says nothing about an environment with no release", async () => {
    const formId = await seedForm("servedwhere", 2);
    await insertFormRelease(testDb.db, {
      formId,
      environment: "test",
      version: 2,
      releasedBy: "usr_alice",
    });

    // Criterion 1, at the level the respondent path reads it: released to `test` and not
    // to `prod`.
    expect((await getReleasedVersion(testDb.db, formId, "test"))?.version).toBe(2);
    expect(await getReleasedVersion(testDb.db, formId, "prod")).toBeUndefined();
  });

  it("records a release straight to `prod` with no prior `test` release (criterion 5)", async () => {
    const formId = await seedForm("hotfix", 1);
    const release = await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 1,
      releasedBy: "usr_oncall",
    });

    // Q4: no ordering requirement. The row records that there was no source, which is
    // what makes the path auditable when there was one.
    expect(release.environment).toBe("prod");
    expect(release.fromEnvironment).toBeNull();
    expect((await getReleasedVersion(testDb.db, formId, "prod"))?.version).toBe(1);
  });

  it("lists the current release per form and environment, newest only", async () => {
    const formId = await seedForm("currentlist", 3);
    for (const version of [1, 2, 3]) {
      await insertFormRelease(testDb.db, {
        formId,
        environment: "test",
        version,
        releasedBy: "usr_alice",
      });
    }
    await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 1,
      releasedBy: "usr_alice",
      fromEnvironment: "test",
    });

    const inTest = (await listCurrentReleases(testDb.db, "test")).filter(
      (row) => row.formId === formId,
    );
    expect(inTest).toHaveLength(1);
    expect(inTest[0]?.version).toBe(3);

    const everywhere = (await listCurrentReleases(testDb.db)).filter(
      (row) => row.formId === formId,
    );
    expect(
      everywhere
        .map((row) => [row.environment, row.version])
        .sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
    ).toEqual([
      ["prod", 1],
      ["test", 3],
    ]);
  });
});

describe("the history answers who, when, from where and with whose approval (criterion 4)", () => {
  it("marks a release of an earlier version as a rollback, derived from the row", async () => {
    const formId = await seedForm("rollback", 7);
    for (const version of [4, 7]) {
      await insertFormRelease(testDb.db, {
        formId,
        environment: "prod",
        version,
        releasedBy: "usr_alice",
      });
    }
    // The incident: version 7 is bad, so version 4 is released again. Nothing is
    // reverted, undone or deleted - this is a third row.
    await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 4,
      releasedBy: "usr_oncall",
    });

    const history = await listFormReleases(testDb.db, formId, "prod");
    expect(history.map((row) => [row.version, row.rollback])).toEqual([
      [4, true],
      [7, false],
      [4, false],
    ]);
    expect(history[0]?.replacedVersion).toBe(7);
    expect(history[0]?.releasedBy).toBe("usr_oncall");
    expect(history[2]?.replacedVersion).toBeNull();
  });

  it("reads each environment's predecessor and not another environment's", async () => {
    // The window function partitions by environment. Without that, releasing 2 to
    // `prod` after 5 to `test` would read as a rollback - two environments moving
    // independently is the ordinary case, not an incident.
    const formId = await seedForm("partition", 5);
    await insertFormRelease(testDb.db, {
      formId,
      environment: "test",
      version: 5,
      releasedBy: "usr_alice",
    });
    await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 2,
      releasedBy: "usr_alice",
      fromEnvironment: "test",
    });

    const history = await listFormReleases(testDb.db, formId);
    const prod = history.filter((row) => row.environment === "prod");
    expect(prod).toHaveLength(1);
    expect(prod[0]?.rollback).toBe(false);
    expect(prod[0]?.replacedVersion).toBeNull();
  });

  it("carries the approval column from this task, unset until task 070 fills it", async () => {
    const formId = await seedForm("approval", 1);
    const release = await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 1,
      releasedBy: "usr_alice",
      approvedBy: "usr_bob",
    });
    // Q51 is task 070's rule and nothing here enforces who may fill this. What this task
    // owns is that the approval is recorded ON the release record, which is what makes it
    // auditable rather than procedural.
    expect(release.approvedBy).toBe("usr_bob");
    expect(
      (
        await insertFormRelease(testDb.db, {
          formId,
          environment: "test",
          version: 1,
          releasedBy: "usr_alice",
        })
      ).approvedBy,
    ).toBeNull();
  });
});

describe("the history is append-only (criterion 7)", () => {
  it("leaves every prior row intact when an earlier version is released", async () => {
    const formId = await seedForm("appendonly", 2);
    await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 2,
      releasedBy: "usr_alice",
    });
    const before = await listFormReleases(testDb.db, formId, "prod");
    await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 1,
      releasedBy: "usr_oncall",
    });

    const after = await listFormReleases(testDb.db, formId, "prod");
    expect(after).toHaveLength(2);
    // The row that was there is byte-for-byte the row that is there.
    expect(after[1]).toMatchObject({
      version: before[0]!.version,
      sequence: before[0]!.sequence,
      releasedAt: before[0]!.releasedAt,
      releasedBy: before[0]!.releasedBy,
    });
  });

  it("rejects an UPDATE and a DELETE at the database", async () => {
    const formId = await seedForm("immutable", 1);
    await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 1,
      releasedBy: "usr_alice",
    });

    await expect(
      testDb.client.query(`update control.form_releases set version = 1 where form_id = $1`, [
        formId,
      ]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      testDb.client.query(`delete from control.form_releases where form_id = $1`, [formId]),
    ).rejects.toThrow(/append-only/i);
  });
});

describe("the released-anywhere filter's input", () => {
  it("names every version that reached an environment, including one rolled away from", async () => {
    const formId = await seedForm("filterinput", 4);
    await insertFormRelease(testDb.db, {
      formId,
      environment: "test",
      version: 2,
      releasedBy: "usr_alice",
    });
    await insertFormRelease(testDb.db, {
      formId,
      environment: "test",
      version: 4,
      releasedBy: "usr_alice",
    });
    await insertFormRelease(testDb.db, {
      formId,
      environment: "test",
      version: 2,
      releasedBy: "usr_alice",
    });

    // "Was released", not "is released": version 4 reached `test` and the filter must
    // still show it, and version 2 appears once rather than twice.
    expect(await listReleasedVersions(testDb.db, formId)).toEqual([4, 2]);
    // Versions 1 and 3 only ever existed in the library, which is the churn finding 2
    // accepted and this filter hides.
    expect(await listReleasedVersions(testDb.db, FormId.parse("frm_sequence"))).toEqual([2, 1]);
  });
});
