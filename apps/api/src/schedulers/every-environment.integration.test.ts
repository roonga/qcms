import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FormId, SessionId, type FormDefinition } from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  createForm,
  createSession,
  enqueue,
  getSession,
  insertDelivery,
  insertFormVersion,
  insertWebhook,
  listWebhooks,
  outbox,
  schema,
  webhookDeliveries,
  type Executor,
} from "@roonga/qcms-db";
import { eq, sql } from "drizzle-orm";
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
import { makeDeps, recordingLogger } from "../test-support.js";

const { Pool } = pg;

const LIVE_SET = ["test", "prod"] as const;

// Fixed instants, so no comparison below turns on the host-to-container clock offset or
// on a timestamp's resolution.
const DUE_AT = new Date("2026-01-01T00:00:00.000Z");
const PASS_AT = new Date("2026-01-01T00:01:00.000Z");
const SWEEP_AT = new Date("2026-02-01T00:00:00.000Z");

let testDb: TestDb;
let databases: Databases;
const executors = new Map<string, Executor>();

beforeAll(async () => {
  testDb = await startTestDb();
  for (const environment of LIVE_SET) {
    const pool = testDb.register(
      new Pool({
        connectionString: testDb.connectionUri,
        // The only thing that makes these pools different: an unqualified name resolves
        // inside this environment's schema and nowhere else.
        options: searchPathOptions(environment),
      }),
      `${environment} pool`,
    );
    executors.set(environment, drizzle(pool, { schema }));
  }
  databases = {
    // Control-plane tables are schema-qualified, so any connection resolves them.
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

async function seedForm(id: string): Promise<{ formId: FormId; version: number }> {
  const formId = FormId.parse(id);
  await createForm(databases.control, {
    workspaceId: SEED_WORKSPACE_ID,
    formId,
    slug: `${id}-slug`,
    defaultLocale: "en",
  });
  const version = await insertFormVersion(databases.control, {
    formId,
    // Empty: nothing under test reads form content.
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
        // Has to be this environment's own name: the schema's CHECK refuses any other.
        environment,
        expiresAt: expired,
      });
      sessionIds.set(environment, sessionId);
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
      const exec = databases.for(environment);
      const row = await enqueue(exec, {
        eventType: "form.released",
        payload: { environment },
      });
      eventIds.set(environment, row.id);
      expect(row.deliveredAt, `${environment} starts unconsumed`).toBeNull();
      // Pinned instead of left on the column's `now()` default, which is the Postgres
      // server's clock at a different resolution from this one.
      await exec.update(outbox).set({ nextAttemptAt: DUE_AT }).where(eq(outbox.id, row.id));
    }

    // The pass catches per environment, so a throw and a never-reached environment leave
    // the same undrained row; the log is the only thing that tells them apart.
    const { logger, lines } = recordingLogger();
    const deps = makeDeps({ databases, logger });
    await runDeliveryPassForEveryEnvironment(deps, { now: PASS_AT });

    expect(
      lines.filter((line) => line.msg === "outbox delivery pass failed"),
      "no environment's pass threw",
    ).toEqual([]);

    for (const environment of LIVE_SET) {
      // This line is logged only after both phases returned, so it is the completion
      // signal. Its metrics count delivery rows, never consumed events.
      const pass = lines.find(
        (line) =>
          line.level === "info" &&
          line.msg === "outbox delivery pass" &&
          line.environment === environment,
      );
      expect(pass, `data_${environment} ran a delivery pass to completion`).toBeDefined();
      expect(pass?.failed, `data_${environment} had no failed delivery`).toBe(0);
    }

    for (const environment of LIVE_SET) {
      const [row] = await databases
        .for(environment)
        .select({ deliveredAt: outbox.deliveredAt })
        .from(outbox)
        .where(eq(outbox.id, eventIds.get(environment)!));
      expect(row?.deliveredAt, `data_${environment}.outbox was drained`).not.toBeNull();
    }
  });
});

describe("the sweep reads each environment's own retention TTL (Q11, criterion 5)", () => {
  async function seedSnippet(environment: string, suffix: string): Promise<string> {
    const exec = databases.for(environment);
    const { formId } = await seedForm(`frm_ttl_${suffix}`);
    const webhookId = `whk_ttl_${suffix}`;
    await insertWebhook(exec, {
      webhookId,
      formId,
      // Never reached: this test drives the sweep, which posts nothing.
      url: "https://consumer.example.com/hook",
      secretEncrypted: "not-a-real-secret",
    });
    const event = await enqueue(exec, { eventType: "response.submitted", payload: {} });
    await insertDelivery(exec, { outboxId: event.id, webhookId });
    const aged = await exec
      .update(webhookDeliveries)
      .set({
        // A CHECK requires `last_attempt_at` on any row holding a snippet.
        lastResponseSnippet: "the consumer echoed the request back",
        lastAttemptAt: new Date(SWEEP_AT.getTime() - 60 * 60 * 1000),
      })
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .returning({ id: webhookDeliveries.id });
    expect(aged, `data_${environment} seeded one delivery with a snippet`).toHaveLength(1);
    return aged[0]!.id;
  }

  async function stillHeld(environment: string, id: string): Promise<boolean> {
    const [row] = await databases
      .for(environment)
      .select({ snippet: webhookDeliveries.lastResponseSnippet })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, id));
    return row?.snippet !== null && row?.snippet !== undefined;
  }

  it("redacts under an environment's own TTL and leaves the other environment alone", async () => {
    const ids = new Map<string, string>();
    for (const environment of LIVE_SET)
      ids.set(environment, await seedSnippet(environment, environment));
    for (const environment of LIVE_SET) {
      expect(
        await stillHeld(environment, ids.get(environment)!),
        `${environment} starts held`,
      ).toBe(true);
    }

    await databases.control.execute(
      sql`update control.environments set delivery_snippet_ttl_ms = 0 where name = 'test'`,
    );
    await databases.control.execute(
      sql`update control.environments set delivery_snippet_ttl_ms = null where name = 'prod'`,
    );

    await sweepEveryEnvironment(makeDeps({ databases }), SWEEP_AT);

    expect(
      await stillHeld("test", ids.get("test")!),
      "data_test's snippet should be gone: that environment's TTL is 0",
    ).toBe(false);
    expect(
      await stillHeld("prod", ids.get("prod")!),
      "data_prod's snippet should remain: no override, so the installation-wide window stands",
    ).toBe(true);
  });
});

describe("a test submission cannot reach a prod endpoint (criterion 1)", () => {
  it("fans out inside the event's own environment and nowhere else", async () => {
    const { formId } = await seedForm("frm_no_cross_env_delivery");

    await insertWebhook(databases.for("prod"), {
      webhookId: "whk_prod_target",
      formId,
      url: "https://prod-consumer.example.com/hook",
      secretEncrypted: "not-a-real-secret",
    });
    await insertWebhook(databases.for("test"), {
      webhookId: "whk_test_target",
      formId,
      url: "https://test-consumer.example.com/hook",
      secretEncrypted: "not-a-real-secret",
    });
    expect(
      (await listWebhooks(databases.for("prod"), formId)).map((row) => row.webhookId),
      "the production endpoint exists and is the deliverer's to find if it can",
    ).toEqual(["whk_prod_target"]);

    const event = await enqueue(databases.for("test"), {
      eventType: "response.submitted",
      payload: { sessionId: "ses_cross_env_probe", formId },
    });
    await databases
      .for("test")
      .update(outbox)
      .set({ nextAttemptAt: DUE_AT })
      .where(eq(outbox.id, event.id));

    await runDeliveryPassForEveryEnvironment(makeDeps({ databases }), { now: PASS_AT });

    const prodDeliveries = await databases
      .for("prod")
      .select({ webhookId: webhookDeliveries.webhookId })
      .from(webhookDeliveries);
    expect(
      prodDeliveries.map((row) => row.webhookId),
      "a test submission materialised a delivery to a production endpoint",
    ).not.toContain("whk_prod_target");

    const testDeliveries = await databases
      .for("test")
      .select({ webhookId: webhookDeliveries.webhookId })
      .from(webhookDeliveries);
    expect(
      testDeliveries.map((row) => row.webhookId),
      "the pass fanned the event out inside its own environment, so the negative above means something",
    ).toContain("whk_test_target");
  });
});
