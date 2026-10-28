import { createEnvironment } from "@roonga/qcms-db";
import { sql } from "drizzle-orm";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";
import {
  EnvironmentSetMismatchError,
  assertEnvironmentsMatch,
  openDatabases,
} from "./environments.js";
import { validEnv } from "./test-support.js";

const TIMEOUT_MS = 30_000;

/** `regclass` resolves the bare name through the session's own `search_path`. */
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
    // One container and one credential, so the resolved schema is the only thing that
    // distinguishes the pools: if it were shared, every per-environment assertion in the
    // suite would be vacuous.
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
    const running = openDatabases(configFor(["test", "prod"]));
    try {
      expect(running.databases.names).toEqual(["test", "prod"]);

      await createEnvironment(testDb.db, { name: "dev" });

      // No reload by decision: a credential the database handed the process would be a
      // credential the database could be made to hand it.
      expect(running.databases.names).toEqual(["test", "prod"]);
      expect(() => running.databases.for("dev")).toThrow(/no connection pool/);

      await expect(assertEnvironmentsMatch(running.databases)).rejects.toThrow(
        /present in control.environments but not configured: dev/,
      );
    } finally {
      await Promise.all(running.pools.map((pool) => pool.end()));
    }

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
    const { databases, pools } = openDatabases(configFor(["test", "prod", "dev", "staging"]));
    try {
      const refusal = await assertEnvironmentsMatch(databases).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(EnvironmentSetMismatchError);
      expect((refusal as Error).message).toMatch(
        /configured but absent from control.environments: staging/,
      );
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });

  it("tells a disagreement apart from a database it could not read, which is what decides the boot", async () => {
    // An unreachable port rather than a stopped container, so the container the rest of
    // this file depends on stays up.
    const unreachable = loadConfig(
      validEnv({
        DATABASE_URL: "postgres://qcms:synthetic@127.0.0.1:1/qcms",
        QCMS_ENVIRONMENTS: "test,prod",
        QCMS_DATABASE_URL_TEST: testDb.connectionUri,
        QCMS_DATABASE_URL_PROD: testDb.connectionUri,
      }),
    );
    const { databases, pools } = openDatabases(unreachable);
    try {
      const failure = await assertEnvironmentsMatch(databases).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(EnvironmentSetMismatchError);
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });
});
