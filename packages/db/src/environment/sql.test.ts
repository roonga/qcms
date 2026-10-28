import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CONTROL_TABLE_NAMES } from "../schema/control/index.js";
import { DATA_PLANE_TABLE_NAMES } from "../schema/data/index.js";

import { environmentObjectNames } from "./sql.js";

/**
 * Literals on purpose: a guard dropped from the schema module would otherwise vanish
 * from the expectation and from the database together, with nothing failing.
 */
const PER_ENVIRONMENT = {
  tables: 8,
  guards: 17,
  inPlaneForeignKeys: 5,
  crossingForeignKeys: 3,
} as const;

describe("the per-environment set", () => {
  const names = environmentObjectNames("test");

  it("is the size the derivation says", () => {
    expect(names.tables).toHaveLength(PER_ENVIRONMENT.tables);
    expect(names.guards).toHaveLength(PER_ENVIRONMENT.guards);
    expect(names.inPlaneForeignKeys).toHaveLength(PER_ENVIRONMENT.inPlaneForeignKeys);
    expect(names.crossingForeignKeys).toHaveLength(PER_ENVIRONMENT.crossingForeignKeys);
    expect(names.foreignKeys).toHaveLength(
      PER_ENVIRONMENT.inPlaneForeignKeys + PER_ENVIRONMENT.crossingForeignKeys,
    );
  });

  it("names every object once", () => {
    expect(new Set(names.guards).size).toBe(names.guards.length);
    expect(new Set(names.foreignKeys).size).toBe(names.foreignKeys.length);
  });

  it("derives every name from the environment it was asked for", () => {
    const prod = environmentObjectNames("prod");
    expect(prod.schema).toBe("data_prod");
    expect(prod.reportingSchema).toBe("reporting_prod");
    expect(prod.role).toBe("qcms_app_prod");
  });
});

describe("the two planes stay disjoint (criterion 3a)", () => {
  it("shares no table name between the control module and the data-plane module", () => {
    // The search path puts the data plane first, so a shared name would silently turn a
    // control-plane read into a per-environment one.
    const control = new Set(CONTROL_TABLE_NAMES);
    const shared = DATA_PLANE_TABLE_NAMES.filter((name) => control.has(name));
    expect(shared).toEqual([]);
  });
});

/** The outbox insert runs on the control pool, whose search path is `control` alone. */
const SCHEMA_QUALIFYING_HELPERS = ["outbox.ts"];

/** Helpers name `data_<env>` in their own prose, which the check must not read. */
function withoutComments(source: string): string {
  // Non-backtracking block-comment body: a lazy `[\s\S]*?` is super-linear here.
  return source.replaceAll(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, "").replaceAll(/\/\/[^\n]*/g, "");
}

describe("no query helper emits a schema-qualified data-plane name", () => {
  const QUERIES_DIR = fileURLToPath(new URL("../queries/", import.meta.url));

  it("names no `data_` schema outside the one helper that must", () => {
    const offenders = readdirSync(QUERIES_DIR)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .filter((name) => !SCHEMA_QUALIFYING_HELPERS.includes(name))
      .filter((name) =>
        /\bdata_/.test(withoutComments(readFileSync(`${QUERIES_DIR}${name}`, "utf8"))),
      );
    expect(offenders).toEqual([]);
  });
});
