/**
 * Exit criterion 9 (ADR-40, Q1, Q2): **the outbox deliverer and the retention sweep each
 * run once and reach every environment in the live set.**
 *
 * # Why this file exists beside the two schedulers' own suites
 *
 * Both schedulers already have integration tests, and both pass against **one**
 * environment - which is exactly the shape that cannot fail. `retention-sweep.integration.test.ts`
 * and `webhook-delivery.integration.test.ts` compose their app through `makeDeps`, whose
 * `singleDatabase` fans one handle out to every pool, so a loop that swept `prod` twice
 * and `test` never would pass every assertion in them. The criterion is about which
 * environments a pass reaches, so the pools have to be genuinely different, and the only
 * thing that makes them different is the `search_path` they connect on.
 *
 * So this file opens **two** pools against the one container, one per shipped
 * environment, seeds a row in each, and asserts that one pass moved both. `data_test` and
 * `data_prod` are separate schemas holding separate tables, so a pass that reached only
 * one leaves the other's row untouched and the assertion names which.
 *
 * # What it deliberately does not do
 *
 * It does not start a timer. `createRetentionSweepScheduler` and the delivery scheduler
 * own the scheduling and are tested on it elsewhere; the criterion is about the pass, so
 * this drives `sweepEveryEnvironment` and `runDeliveryPassForEveryEnvironment` directly.
 * That is also why both are exported rather than buried in a timer callback: a loop that
 * can only be reached through `setTimeout` can only be asserted by driving the clock, and
 * the failure this guards against has nothing to do with time.
 *
 * Requires Docker, like every `*.integration.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FormId, SessionId, type FormDefinition } from "@roonga/qcms-core";
import {
  createForm,
  createSession,
  enqueue,
  getSession,
  insertFormVersion,
  outbox,
  schema,
  type Executor,
} from "@roonga/qcms-db";
import { eq } from "drizzle-orm";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  searchPathOptions,
  startTestDb,
  type TestDb,
} from "@roonga/qcms-db/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import type { Databases } from "../environments.js";
import { runDeliveryPassForEveryEnvironment } from "./outbox-delivery.js";
import { sweepEveryEnvironment } from "./retention-sweep.js";
import { makeDeps } from "../test-support.js";

const { Pool } = pg;

/**
 * The live set this file runs against, which is also the set a fresh database is created
 * with (`SHIPPED_ENVIRONMENTS`). Two is the smallest number that can tell "reaches every
 * environment" from "reaches one", which is the whole point of the file.
 */
const LIVE_SET = ["test", "prod"] as const;

let testDb: TestDb;
let databases: Databases;
/** One executor per environment, each on its own `data_<env>, control` search path. */
const executors = new Map<string, Executor>();

beforeAll(async () => {
  testDb = await startTestDb();
  for (const environment of LIVE_SET) {
    const pool = testDb.register(
      new Pool({
        connectionString: testDb.connectionUri,
        // The one thing that makes these pools different, and the reason a single handle
        // could never fail this test: an unqualified `sessions` resolves inside this
        // environment's schema and nowhere else (ADR-40, criterion 3).
        options: searchPathOptions(environment),
      }),
      `${environment} pool`,
    );
    executors.set(environment, drizzle(pool, { schema }));
  }
  databases = {
    // Authoring reads and writes are the control plane's. Every table on it is declared
    // schema-qualified, so any of these connections resolves them; `test`'s is used so
    // nothing here depends on `prod` being the interim default.
    control: executors.get("test")!,
    names: [...LIVE_SET],
    defaultEnvironment: "prod",
    for: (environment: string) => {
      const found = executors.get(environment);
      if (found === undefined) throw new Error(`no pool for environment ${environment}`);
      return found;
    },
    forRequest: () => ({ environment: "prod", exec: executors.get("prod")! }),
  };
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

/**
 * A form and one published version in `control`, so a session in either environment has
 * its crossing foreign key satisfied.
 *
 * One copy for both environments, because `forms` and `form_versions` are control-plane
 * tables and there is one of each whatever the environment set is - which is itself the
 * shape ADR-40 chose, and the reason an environment role holds `SELECT` on them.
 */
async function seedForm(id: string): Promise<{ formId: FormId; version: number }> {
  const formId = FormId.parse(id);
  await createForm(databases.control, { formId, slug: `${id}-slug`, defaultLocale: "en" });
  const version = await insertFormVersion(databases.control, {
    formId,
    // Empty definition and compiled output: nothing under test reads form content.
    definition: {} as unknown as FormDefinition,
    compiled: {},
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  } as unknown as Parameters<typeof insertFormVersion>[1]);
  return { formId, version: version.version };
}

describe("one pass reaches every environment in the live set (criterion 9)", () => {
  it("expires an abandoned session in each environment, from one retention sweep", async () => {
    const { formId, version } = await seedForm("frm_sweep_every_env");
    const expired = new Date(Date.now() - 60_000);
    const sessionIds = new Map<string, SessionId>();

    for (const environment of LIVE_SET) {
      const sessionId = SessionId.parse(`ses_sweep_${environment}_aaaaaaa`);
      await createSession(databases.for(environment), {
        sessionId,
        formId,
        formVersion: version,
        accessMode: "anonymous",
        // Q46's column, and it has to be this environment's own name: the schema's
        // `CHECK` refuses any other, which is the guard working rather than a formality.
        environment,
        expiresAt: expired,
      });
      sessionIds.set(environment, sessionId);
      // The precondition. Without it a sweep that did nothing at all would pass below.
      // `created` is a fresh session's status and one of the two `expireSessions` moves.
      expect(
        (await getSession(databases.for(environment), sessionId))?.status,
        `${environment} starts created`,
      ).toBe("created");
    }

    const deps = makeDeps({ databases });
    await sweepEveryEnvironment(deps, new Date());

    for (const environment of LIVE_SET) {
      const row = await getSession(databases.for(environment), sessionIds.get(environment)!);
      expect(row?.status, `data_${environment}.sessions was swept`).toBe("expired");
    }
  });

  it("consumes an outbox event in each environment, from one delivery pass", async () => {
    const eventIds = new Map<string, string>();
    for (const environment of LIVE_SET) {
      const row = await enqueue(databases.for(environment), {
        eventType: "form.published",
        payload: { environment },
      });
      eventIds.set(environment, row.id);
      // The precondition: a pass that did nothing would otherwise pass below.
      expect(row.deliveredAt, `${environment} starts unconsumed`).toBeNull();
    }

    const deps = makeDeps({ databases });
    // An explicit `now`, because `makeDeps` injects a fixed clock set in the past and
    // `claimDue` will not claim a row whose `next_attempt_at` default is the real insert
    // time. Real wall time here rather than a moved clock: the assertion is about which
    // environment the pass reached, not about when it ran.
    await runDeliveryPassForEveryEnvironment(deps, { now: new Date() });

    for (const environment of LIVE_SET) {
      // `form.published` fans out to no webhook, so the pass's whole visible effect here
      // is the event being consumed - which is the right signal: `markDelivered` is
      // written by the materialize phase in the environment the pass reached, and by
      // nothing else. The read is unqualified, so it can only see this environment's
      // `outbox`.
      const [row] = await databases
        .for(environment)
        .select({ deliveredAt: outbox.deliveredAt })
        .from(outbox)
        .where(eq(outbox.id, eventIds.get(environment)!));
      expect(row?.deliveredAt, `data_${environment}.outbox was drained`).not.toBeNull();
    }
  });
});
