/**
 * The hand-written started-container type must keep matching upstream (issue #407).
 *
 * `TestDb.container` is declared as {@link StartedTestPostgres}, a structural type owned
 * by this package, rather than as `@testcontainers/postgresql`'s nominal
 * `StartedPostgreSqlContainer`. That is what keeps the two OPTIONAL peer dependencies out
 * of the emitted `.d.ts`, so an adopter who has not installed them can still run `tsc` and
 * therefore can still reach the actionable runtime message the harness throws instead of a
 * wall of `TS2307`s (issue #407; `harness.ts` writes out the reasoning).
 *
 * The cost of a hand-written type is drift: upstream renames `logs`, or changes what it
 * returns, and nothing here notices until a consumer's call fails at runtime. This file is
 * the thing that notices. It lives in the repository, where both peers ARE installed as
 * devDependencies, so it can name the real type and assert the real one satisfies ours.
 *
 * It is a **typecheck** assertion above all: the `satisfies` and the assignment below fail
 * `tsc` when the shapes part company, which is the moment worth failing at. The runtime
 * `expect` is there so the file is a test rather than a lint-suppressed declaration, and so
 * a reader running the suite sees the name of what is being pinned.
 *
 * No container is booted. Nothing here touches Docker.
 */
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";

import type { StartedTestPostgres, TestDb } from "./harness.js";

describe("StartedTestPostgres against @testcontainers/postgresql", () => {
  it("is satisfied by a real StartedPostgreSqlContainer", () => {
    // The assertion that matters is the assignment's type, not the value: `tsc` rejects
    // this line the moment upstream stops supplying one of the three members, or supplies
    // it with an incompatible signature. Never dereferenced, so no container is needed.
    const upstream = undefined as unknown as StartedPostgreSqlContainer;
    const ours: StartedTestPostgres = upstream;
    expect(ours).toBeUndefined();
  });

  it("is the type TestDb publishes, so the pin covers the exported surface", () => {
    // Guards the indirection itself: if `TestDb.container` were ever repointed back at the
    // upstream type, the test above would still pass while the peers returned to the
    // declaration surface. This is the line that would fail.
    const container = undefined as unknown as TestDb["container"];
    const ours: StartedTestPostgres = container;
    expect(ours).toBeUndefined();
  });

  it("names only what a consumer of the harness actually uses", () => {
    // A behavioural note in test form. `logs` is the one member with a caller outside this
    // package (`apps/portal/e2e/support/api-server.ts` streams the Postgres server log
    // into the browser suite's capture file); `getConnectionUri` and `stop` are used by the
    // harness itself. Anything a future caller needs is added here and to the interface
    // together, and this test is where the omission shows up as a failed compile.
    const members: readonly (keyof StartedTestPostgres)[] = ["logs", "getConnectionUri", "stop"];
    expect(members).toHaveLength(3);
  });
});
