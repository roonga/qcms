import { describe, expect, it } from "vitest";

import { schemasForEnvironments } from "./drill-restore.mjs";

/**
 * The restore drill covers `control` and every environment in the live set (ADR-40; task
 * 067, criterion 2).
 *
 * The drill itself needs Docker, three images and a dropped database, so what is tested
 * here is the one part of it that decides **what gets covered**. That part is worth a test
 * of its own precisely because it is the part a future environment silently falls out of:
 * a hand-written schema list would keep passing while covering two of three environments,
 * and the failure would be a backup nobody had restored, which is the claim
 * `docs/backup-restore.md` opens by refusing.
 */
describe("the schemas the drill covers", () => {
  it("covers control plus a data and a reporting schema per environment", () => {
    expect(schemasForEnvironments("test\nprod\n")).toEqual([
      "control",
      "data_test",
      "reporting_test",
      "data_prod",
      "reporting_prod",
    ]);
  });

  it("covers an environment created after the feature shipped, with no code change", () => {
    // Criterion 2's second clause, as the assertion it asks for. The input is what
    // `control.environments` answers after `qcms-db-environment create dev`; the output is
    // two more schemas, derived rather than added here.
    expect(schemasForEnvironments("test\nprod\ndev\n")).toEqual([
      "control",
      "data_test",
      "reporting_test",
      "data_prod",
      "reporting_prod",
      "data_dev",
      "reporting_dev",
    ]);
  });

  it("keeps the table's own order, which is the order every environment list uses", () => {
    // `position` is the canonical order a combined environment set is written in (Q42), and
    // the coverage line the drill prints is read beside the switcher and the access-group
    // names. Re-sorting here would make one list disagree with the others.
    expect(schemasForEnvironments("prod\ntest\n")).toEqual([
      "control",
      "data_prod",
      "reporting_prod",
      "data_test",
      "reporting_test",
    ]);
  });

  it("refuses an empty set rather than covering only `control`", () => {
    // A database whose environment set is empty is one that never migrated or never
    // seeded, and a drill that fingerprinted `control` alone there would pass on a
    // database with no data plane at all.
    expect(() => schemasForEnvironments("")).toThrow(/no environment to cover/);
    expect(() => schemasForEnvironments("  \n \n")).toThrow(/no environment to cover/);
  });
});
