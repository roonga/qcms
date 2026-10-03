import { createEnvironment } from "@roonga/qcms-db";
import { sql } from "drizzle-orm";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";
import { assertEnvironmentsMatch, openDatabases } from "./environments.js";
import { validEnv } from "./test-support.js";

/**
 * The credential and discovery story, against a real Postgres (criteria 5, 6 and 6a).
 *
 * ## What this file is about
 *
 * Three things have to line up before a request can be served from an environment: a row
 * in `control.environments`, a credential in the typed configuration, and a pool built
 * from it at boot. This file drives all three, in the order an operator meets them.
 *
 * **A new environment needs a restart** (Code Owner, 2026-09-30, Q59). That is the
 * decision, not a limitation nobody got round to: the credential for an environment is a
 * per-environment entry in the typed configuration (ADR-24) and arrives through the
 * process environment, so a running process knows nothing about an environment created
 * under it. ADR-24 parses configuration at boot and fails fast, and a reload path would
 * be a new capability in that decision - the process would have to accept a credential it
 * had not validated at startup. Restart is also the honest operational story: the
 * operator has just run a command with the migration credential and is already in a
 * change window.
 *
 * So the assertion below is deliberately in two halves: **not served before the restart,
 * served after it**. A test that only checked the second half would pass just as well
 * against a live-reload implementation nobody asked for, and the first half is what says
 * the absence of one is a property rather than an oversight.
 */

const TIMEOUT_MS = 30_000;

/**
 * Which schema an **unqualified** `sessions` resolves to on this connection.
 *
 * The resolution half of criterion 3, asked of Postgres rather than of the connection
 * string: `regclass` resolves the bare name through the session's own `search_path`, so
 * the answer is what a query helper would have reached.
 */
const RESOLVED_SESSIONS_SCHEMA = sql`
  select n.nspname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.oid = 'sessions'::regclass`;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

/** The configuration a process booted against this container with `names` would hold. */
function configFor(names: readonly string[]) {
  const credentials: Record<string, string> = {};
  for (const name of names)
    credentials[`QCMS_DATABASE_URL_${name.toUpperCase()}`] = testDb.connectionUri;
  return loadConfig(
    validEnv({
      DATABASE_URL: testDb.connectionUri,
      QCMS_ENVIRONMENTS: names.join(","),
      ...credentials,
    }),
  );
}

describe("a process holds one pool per configured environment", { timeout: TIMEOUT_MS }, () => {
  it("builds a pool for each, and refuses a name it has no credential for", async () => {
    const { databases, pools } = openDatabases(configFor(["test", "prod"]));
    try {
      expect(databases.names).toEqual(["test", "prod"]);
      // Throws rather than falling back to the default: a request that somehow reached a
      // handler naming an environment this deployment does not serve is a request whose
      // environment is unknown, and serving it from `prod` is the failure Q19 refuses in
      // the link-minting case for exactly the same reason.
      expect(() => databases.for("dev")).toThrow(/no connection pool for environment dev/);
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });

  it("serves every request from `prod` until tasks 065 and 066 land (Q53)", async () => {
    const { databases, pools } = openDatabases(configFor(["test", "prod"]));
    try {
      expect(databases.forRequest().environment).toBe("prod");
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });

  it("gives each pool its own environment's search path, not a shared one", async () => {
    // One container and one credential here, so what distinguishes the pools is exactly
    // the thing that distinguishes them in production: the schema an unqualified name
    // resolves in. If both pools resolved `sessions` in the same schema, every
    // per-environment assertion in the suite would be vacuous.
    const { databases, pools } = openDatabases(configFor(["test", "prod"]));
    try {
      for (const environment of ["test", "prod"]) {
        const res = await databases
          .for(environment)
          .execute<{ nspname: string }>(RESOLVED_SESSIONS_SCHEMA);
        expect(res.rows[0]?.nspname).toBe(`data_${environment}`);
      }
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });
});

describe("an environment created after boot (Q59)", { timeout: TIMEOUT_MS }, () => {
  it("is not served by the running process, and is after a restart", async () => {
    // 1. The process as it booted: two environments, two pools.
    const running = openDatabases(configFor(["test", "prod"]));
    try {
      expect(running.databases.names).toEqual(["test", "prod"]);

      // 2. The operator creates one, under the migration credential, while it runs.
      await createEnvironment(testDb.db, { name: "dev" });

      // 3. The running process still does not serve it. No reload, by decision: it holds
      // no credential for `dev`, and a credential the database handed it would be a
      // credential the database could be made to hand it.
      expect(running.databases.names).toEqual(["test", "prod"]);
      expect(() => running.databases.for("dev")).toThrow(/no connection pool/);

      // 4. And the boot check now refuses this configuration outright, which is what
      // turns "silently missing an environment" into "says so at boot" (criterion 6a).
      await expect(assertEnvironmentsMatch(running.databases)).rejects.toThrow(
        /present in control.environments but not configured: dev/,
      );
    } finally {
      await Promise.all(running.pools.map((pool) => pool.end()));
    }

    // 5. The restart: the operator sets QCMS_DATABASE_URL_DEV, adds `dev` to
    // QCMS_ENVIRONMENTS, and the process comes back holding three pools.
    const restarted = openDatabases(configFor(["test", "prod", "dev"]));
    try {
      expect(restarted.databases.names).toEqual(["test", "prod", "dev"]);
      await assertEnvironmentsMatch(restarted.databases);
      const res = await restarted.databases
        .for("dev")
        .execute<{ nspname: string }>(RESOLVED_SESSIONS_SCHEMA);
      expect(res.rows[0]?.nspname).toBe("data_dev");
    } finally {
      await Promise.all(restarted.pools.map((pool) => pool.end()));
    }
  });

  it("refuses to boot when the configuration names an environment the database lacks", async () => {
    // The other direction of criterion 6a, and a different operational mistake: a
    // credential for an environment nobody created would open a pool whose search path
    // resolves to nothing, and every request through it would fail on a missing relation
    // rather than on a misconfiguration.
    const { databases, pools } = openDatabases(configFor(["test", "prod", "dev", "staging"]));
    try {
      await expect(assertEnvironmentsMatch(databases)).rejects.toThrow(
        /configured but absent from control.environments: staging/,
      );
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });
});
