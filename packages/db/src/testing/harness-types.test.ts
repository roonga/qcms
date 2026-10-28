/**
 * `TestDb.container` is declared structurally to keep the optional peers out of the
 * emitted `.d.ts`, so the assignments below are what notice upstream drift. They
 * are typecheck assertions: `tsc` rejects them when the shapes part company.
 */
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";

import type { StartedTestPostgres, TestDb } from "./harness.js";

describe("StartedTestPostgres against @testcontainers/postgresql", () => {
  it("is satisfied by a real StartedPostgreSqlContainer", () => {
    // Never dereferenced, so no container is needed.
    const upstream = undefined as unknown as StartedPostgreSqlContainer;
    const ours: StartedTestPostgres = upstream;
    expect(ours).toBeUndefined();
  });

  it("is the type TestDb publishes, so the pin covers the exported surface", () => {
    const container = undefined as unknown as TestDb["container"];
    const ours: StartedTestPostgres = container;
    expect(ours).toBeUndefined();
  });

  it("names only what a consumer of the harness actually uses", () => {
    const members: readonly (keyof StartedTestPostgres)[] = [
      "logs",
      "getConnectionUri",
      "exec",
      "stop",
    ];
    expect(members).toHaveLength(4);
  });
});
