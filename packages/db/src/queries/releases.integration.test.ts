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

/**
 * The release record against a real Postgres (task 065, ADR-40).
 *
 * Real Postgres rather than a fake, because everything asserted below is a property of
 * SQL: whether the sequence a concurrent release gets is unique, whether a window
 * function reaches the previous release of the same environment and not of another,
 * whether `environmentStatesByForm`'s `distinct on (form_id)` picks the newest row per
 * form in one environment, and whether the append-only triggers reject an UPDATE and a
 * DELETE. The grants that decide who may write a release row are a different question
 * and are asserted in `apps/api/e2e/security/03-db-least-privilege.e2e.ts`, which
 * connects as the real roles.
 *
 * **The closed state is here too, since task 066** (Q18): it is a value of this state
 * rather than a table beside it, so closing and reopening are appends with the same
 * properties - one read answers both questions, the history records who closed `prod`,
 * and nothing can rewrite it.
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

  /**
   * The uniqueness the docblock above claims, fired concurrently rather than argued.
   *
   * Six inserts of six different versions into one (form, environment), started together
   * on six pool connections. `insertFormRelease` reads `max(sequence) + 1` in the same
   * statement that inserts, and under `READ COMMITTED` none of the six sees another's
   * uncommitted row, so they all compute the same next sequence. The composite primary key
   * is what makes that safe: one insert per sequence lands and the rest are refused by
   * name, so a sequence can never be handed to two rows. A nextval-style counter would
   * accept them all and leave two rows claiming the same place in one history.
   *
   * The API turns that refusal into a 409 `RELEASE_RACED`; that half is asserted in
   * `apps/api/src/features/releases/releases.integration.test.ts`.
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
    // Every refusal is the key, not a deadlock or a serialization failure: this guard is
    // the primary key doing its job, and a different error would mean a different story.
    expect(refused).toEqual(refused.map(() => "form_releases_form_id_environment_sequence_pk"));

    // No sequence was handed out twice, and the history is dense from 1 - so the winners
    // are a prefix of the history and no row was skipped over or overwritten.
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

    // "What is released where", which is what the admin's release screen shows for one
    // form: the newest row per environment and nothing older, read per pair rather than
    // computed from the history by the caller.
    expect((await getReleasedVersion(testDb.db, formId, "test"))?.version).toBe(3);
    expect((await getReleasedVersion(testDb.db, formId, "prod"))?.version).toBe(1);
    // Every row is still there behind those two answers.
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

    // The close carries the released version forward, so what a respondent would be
    // pinned to is undisturbed by intake stopping.
    expect(closed?.version).toBe(2);
    expect(closed?.closed).toBe(true);
    expect(closed?.fromEnvironment).toBeNull();
    expect(await getFormEnvironmentState(testDb.db, formId, "prod")).toEqual({
      version: 2,
      closed: true,
    });
    // And `test` is untouched, which is the whole of Q18: one form, two environments,
    // two intake states.
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
    // There is no state to close: `version` is NOT NULL and keyed into
    // `control.form_versions`, so a row carrying no version is not expressible, and a
    // start there already refuses with NO_PUBLISHED_VERSION.
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
    // The release that preceded it is intact and is still not a rollback: the close
    // carried the same version, so no version moved backwards.
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
    // The release handler reads the current value and passes it (`recordRelease`), which
    // is what makes "a release does not reopen a closed environment" a property of the
    // state rather than of a handler's good manners.
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
    // A form released only to `test` is absent from `prod`'s map rather than present and
    // open: "nothing is released here" and "released and open" are different answers.
    expect(states.has(otherEnvironment)).toBe(false);
  });
});
