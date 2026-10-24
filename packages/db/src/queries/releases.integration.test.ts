import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import { FormId } from "@roonga/qcms-core";
import type { FormDefinition } from "@roonga/qcms-core";

import {
  SEED_WORKSPACE_ID,
  CONTAINER_BOOT_TIMEOUT_MS,
  startTestDb,
  type TestDb,
} from "../testing/harness.js";
import {
  closeFormInEnvironment,
  createForm,
  environmentStatesByForm,
  getFormEnvironmentState,
  getReleasedVersion,
  insertFormRelease,
  insertFormVersion,
  listFormReleases,
  listReleasedVersions,
  reopenFormInEnvironment,
} from "./index.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as CompiledForm;

/** Drizzle wraps the driver error, so the constraint name is on the `cause`. */
async function refusedBy(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { constraint?: string }; constraint?: string }).cause;
    return cause?.constraint ?? (error as { constraint?: string }).constraint;
  }
  throw new Error("expected the statement to be refused");
}

async function seedForm(label: string, versions = 1): Promise<FormId> {
  const formId = FormId.parse(`frm_${label}`);
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId,
    slug: `${label}-slug`,
    defaultLocale: "en",
  });
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
    expect(firstInProd.sequence).toBe(1);
  });

  /**
   * Under `READ COMMITTED` every concurrent insert computes the same next sequence,
   * so the composite primary key is what keeps one of them from landing twice.
   */
  it("hands a concurrent release a unique sequence, and refuses the loser by name", async () => {
    const formId = await seedForm("concurrent", 6);
    const attempts = await Promise.all(
      [1, 2, 3, 4, 5, 6].map(async (version) => {
        try {
          const row = await insertFormRelease(testDb.db, {
            formId,
            environment: "test",
            version,
            releasedBy: "usr_alice",
          });
          return { sequence: row.sequence, constraint: undefined };
        } catch (error) {
          const cause = (error as { cause?: { constraint?: string } }).cause;
          return { sequence: undefined, constraint: cause?.constraint ?? "unknown" };
        }
      }),
    );

    const landed = attempts.flatMap((a) => (a.sequence === undefined ? [] : [a.sequence]));
    const refused = attempts.flatMap((a) => (a.constraint === undefined ? [] : [a.constraint]));
    expect(landed.length).toBeGreaterThanOrEqual(1);
    expect(landed.length + refused.length).toBe(attempts.length);
    expect(refused).toEqual(refused.map(() => "form_releases_form_id_environment_sequence_pk"));

    const sequences = [...landed].sort((a, b) => a - b);
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(sequences).toEqual(landed.map((_, index) => index + 1));
    const stored = await listFormReleases(testDb.db, formId, "test");
    expect(stored.map((row) => row.sequence).sort((a, b) => a - b)).toEqual(sequences);
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

    expect(release.environment).toBe("prod");
    expect(release.fromEnvironment).toBeNull();
    expect((await getReleasedVersion(testDb.db, formId, "prod"))?.version).toBe(1);
  });

  it("answers the current release per environment from the newest row of each pair", async () => {
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

    expect((await getReleasedVersion(testDb.db, formId, "test"))?.version).toBe(3);
    expect((await getReleasedVersion(testDb.db, formId, "prod"))?.version).toBe(1);
    expect(await listFormReleases(testDb.db, formId)).toHaveLength(4);
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

    expect(await listReleasedVersions(testDb.db, formId)).toEqual([4, 2]);
    expect(await listReleasedVersions(testDb.db, FormId.parse("frm_sequence"))).toEqual([2, 1]);
  });
});

describe("the closed state is per (form, environment) (Q18, task 066)", () => {
  it("closes one environment and leaves the other serving (criterion 5)", async () => {
    const formId = await seedForm("closedsplit", 2);
    await insertFormRelease(testDb.db, {
      formId,
      environment: "test",
      version: 1,
      releasedBy: "usr_alice",
    });
    await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 2,
      releasedBy: "usr_alice",
    });

    const closed = await closeFormInEnvironment(testDb.db, {
      formId,
      environment: "prod",
      closedBy: "usr_bob",
    });

    expect(closed?.version).toBe(2);
    expect(closed?.closed).toBe(true);
    expect(closed?.fromEnvironment).toBeNull();
    expect(await getFormEnvironmentState(testDb.db, formId, "prod")).toEqual({
      version: 2,
      closed: true,
    });
    expect(await getFormEnvironmentState(testDb.db, formId, "test")).toEqual({
      version: 1,
      closed: false,
    });

    const reopened = await reopenFormInEnvironment(testDb.db, {
      formId,
      environment: "prod",
      reopenedBy: "usr_bob",
    });
    expect(reopened?.closed).toBe(false);
    expect(reopened?.version).toBe(2);
    expect(await getFormEnvironmentState(testDb.db, formId, "prod")).toEqual({
      version: 2,
      closed: false,
    });
  });

  it("refuses to close an environment the form was never released to", async () => {
    const formId = await seedForm("closednothing", 1);
    expect(
      await closeFormInEnvironment(testDb.db, {
        formId,
        environment: "test",
        closedBy: "usr_bob",
      }),
    ).toBeUndefined();
    expect(await getFormEnvironmentState(testDb.db, formId, "test")).toBeUndefined();
  });

  it("records who closed it and when, append-only, in the one history", async () => {
    const formId = await seedForm("closedaudit", 1);
    await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 1,
      releasedBy: "usr_alice",
    });
    await closeFormInEnvironment(testDb.db, { formId, environment: "prod", closedBy: "usr_bob" });

    const history = await listFormReleases(testDb.db, formId, "prod");
    const latest = history[0]!;
    expect([latest.closed, latest.releasedBy, latest.sequence]).toEqual([true, "usr_bob", 2]);
    expect(history[1]!.closed).toBe(false);
    expect(latest.rollback).toBe(false);
    expect(latest.replacedVersion).toBe(1);
  });

  it("carries the closed state forward across a later release", async () => {
    const formId = await seedForm("closedcarry", 2);
    await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 1,
      releasedBy: "usr_alice",
    });
    await closeFormInEnvironment(testDb.db, { formId, environment: "prod", closedBy: "usr_bob" });
    const current = await getFormEnvironmentState(testDb.db, formId, "prod");
    await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 2,
      releasedBy: "usr_alice",
      closed: current?.closed ?? false,
    });

    expect(await getFormEnvironmentState(testDb.db, formId, "prod")).toEqual({
      version: 2,
      closed: true,
    });
  });

  it("reads one environment's newest row per form for the library list", async () => {
    const closedForm = await seedForm("libclosed", 1);
    const openForm = await seedForm("libopen", 1);
    const otherEnvironment = await seedForm("libother", 1);
    for (const formId of [closedForm, openForm]) {
      await insertFormRelease(testDb.db, {
        formId,
        environment: "prod",
        version: 1,
        releasedBy: "usr_alice",
      });
    }
    await insertFormRelease(testDb.db, {
      formId: otherEnvironment,
      environment: "test",
      version: 1,
      releasedBy: "usr_alice",
    });
    await closeFormInEnvironment(testDb.db, {
      formId: closedForm,
      environment: "prod",
      closedBy: "usr_bob",
    });

    const states = await environmentStatesByForm(testDb.db, "prod");
    expect(states.get(closedForm)).toEqual({ version: 1, closed: true });
    expect(states.get(openForm)).toEqual({ version: 1, closed: false });
    expect(states.has(otherEnvironment)).toBe(false);
  });
});
