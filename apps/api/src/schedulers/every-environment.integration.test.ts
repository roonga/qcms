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

/**
 * The live set this file runs against, which is also the set a fresh database is created
 * with (`SHIPPED_ENVIRONMENTS`). Two is the smallest number that can tell "reaches every
 * environment" from "reaches one", which is the whole point of the file.
 */
const LIVE_SET = ["test", "prod"] as const;

/**
 * The delivery test's two instants, both fixed here rather than read from a clock.
 *
 * Every timestamp that test compares is one of these two, so the assertion cannot turn
 * on the resolution of a clock or on the offset between the host's and the container's.
 * The order is the only thing that matters: the row is due, then the pass runs.
 */
const DUE_AT = new Date("2026-01-01T00:00:00.000Z");
const PASS_AT = new Date("2026-01-01T00:01:00.000Z");

/**
 * The instant the per-environment retention sweep below runs at.
 *
 * Fixed for the reason the two above are, and in this case load bearing twice over: the
 * assertion turns on the distance between a row's `last_attempt_at` and a horizon computed
 * from this value minus a TTL, so both sides have to be on one clock or the test is
 * measuring the host-to-container offset.
 */
const SWEEP_AT = new Date("2026-02-01T00:00:00.000Z");

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
  await createForm(databases.control, {
    workspaceId: SEED_WORKSPACE_ID,
    formId,
    slug: `${id}-slug`,
    defaultLocale: "en",
  });
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
      const exec = databases.for(environment);
      const row = await enqueue(exec, {
        eventType: "form.released",
        payload: { environment },
      });
      eventIds.set(environment, row.id);
      // The precondition: a pass that did nothing would otherwise pass below.
      expect(row.deliveredAt, `${environment} starts unconsumed`).toBeNull();
      // **Pin the due time instead of leaving it on the column's `now()` default.**
      //
      // `enqueue` lets `next_attempt_at` default to Postgres `now()`, and `claimDue`
      // filters `lte(next_attempt_at, at)` against the `at` the caller passes. Those two
      // values come from **different clocks at different resolutions**: `now()` is the
      // server's, to the microsecond, while a JS `Date` is the client's, truncated to
      // the millisecond on capture and again when pg serialises it. An earlier version
      // of this test passed `new Date()` captured after the enqueues and so compared the
      // two directly, which is only ever held positive by the round trip.
      //
      // That is not a theoretical margin. Measured on the development host over 300
      // insert-then-capture pairs against the harness container: the captured client
      // time was **earlier** than the row's server time in 233 of them, median
      // `-0.264 ms`, worst `-0.852 ms`. So the comparison turns on host-to-container
      // clock offset and sub-millisecond truncation, and it failed on CI's `node-24`
      // runner while passing on `node-26` in the same run for exactly that reason.
      //
      // Writing the due time here puts **both sides of the comparison on this clock**:
      // the stored value and `PASS_AT` below are two constants chosen in this file, so
      // the assertion no longer depends on either clock or on any resolution. The
      // production default is still what it was; what is removed is this test's
      // dependence on it.
      await exec.update(outbox).set({ nextAttemptAt: DUE_AT }).where(eq(outbox.id, row.id));
    }

    // A recording logger, because `runDeliveryPassForEveryEnvironment` catches and logs
    // per environment so the pass can step over one unreachable database. That means an
    // environment whose pass **threw** leaves the same observable as one the loop never
    // reached: in both, the row is simply not drained. Asserting the log as well as the
    // row is what tells those two apart, so a future failure here says which it was.
    const { logger, lines } = recordingLogger();
    const deps = makeDeps({ databases, logger });
    await runDeliveryPassForEveryEnvironment(deps, { now: PASS_AT });

    // No environment's pass threw. Asserted before the per-environment checks, and
    // carrying the lines themselves, so a swallowed error is reported as the error it
    // was rather than as an undrained row.
    expect(
      lines.filter((line) => line.msg === "outbox delivery pass failed"),
      "no environment's pass threw",
    ).toEqual([]);

    for (const environment of LIVE_SET) {
      // The pass **completed** in this environment. `runDeliveryPass` logs this line
      // after both phases have returned, so its presence is the completion signal and
      // its absence beside an error line above is a throw. That is the distinction the
      // row alone cannot make.
      //
      // Note what the metrics on this line do *not* say: every one of them counts
      // webhook **delivery rows**, not consumed outbox events, so `form.released`
      // leaves them all at zero however many events it consumed. The drained row below
      // is the only evidence of consumption, which is why both assertions are here.
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
      // `form.released` fans out to no webhook, so the pass's whole visible effect here
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

/**
 * The retention TTLs are per environment (Q11, ADR-24's amendment; task 067, criterion 5).
 *
 * This is the half of criterion 5 that the sweep test above cannot reach. That one asserts
 * the pass **reaches** every environment; this one asserts it **reads each environment's
 * own policy** and that a pass over one does not age a row in another - which is the same
 * sentence from the other side, and the direction a shared-handle test could never fail.
 *
 * The shape is the smallest that can tell the two apart. `test` is given a TTL of `0`,
 * which is a supported setting meaning "at the next sweep", and `prod` is left `NULL`,
 * which means the installation-wide seven days. One row in each environment is aged an
 * hour: `test`'s is past its own horizon and `prod`'s is nowhere near its, so a sweep that
 * read one number for both leaves the wrong pair of rows behind whichever number it read.
 */
describe("the sweep reads each environment's own retention TTL (Q11, criterion 5)", () => {
  /** A delivery row carrying a consumer's response body, aged an hour. */
  async function seedSnippet(environment: string, suffix: string): Promise<string> {
    const exec = databases.for(environment);
    const { formId } = await seedForm(`frm_ttl_${suffix}`);
    const webhookId = `whk_ttl_${suffix}`;
    await insertWebhook(exec, {
      webhookId,
      formId,
      // Never reached: this test drives the sweep, which never posts anything. The URL
      // is the shape the config guard accepts so the row is an ordinary one.
      url: "https://consumer.example.com/hook",
      secretEncrypted: "not-a-real-secret",
    });
    const event = await enqueue(exec, { eventType: "response.submitted", payload: {} });
    await insertDelivery(exec, { outboxId: event.id, webhookId });
    const aged = await exec
      .update(webhookDeliveries)
      .set({
        // The two columns the sweep's predicate reads. `last_attempt_at` is not null,
        // which migration 0015's CHECK requires of any row holding a snippet.
        lastResponseSnippet: "the consumer echoed the request back",
        lastAttemptAt: new Date(SWEEP_AT.getTime() - 60 * 60 * 1000),
      })
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .returning({ id: webhookDeliveries.id });
    expect(aged, `data_${environment} seeded one delivery with a snippet`).toHaveLength(1);
    return aged[0]!.id;
  }

  /** Whether that delivery still holds its snippet. */
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
    for (const environment of LIVE_SET) ids.set(environment, await seedSnippet(environment, environment));
    for (const environment of LIVE_SET) {
      expect(await stillHeld(environment, ids.get(environment)!), `${environment} starts held`).toBe(
        true,
      );
    }

    // `test` keeps a consumer's response body for no time at all; `prod` says nothing and
    // therefore keeps the installation-wide seven days. Written through the column the
    // operator command writes, which is the only writer in production.
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

/**
 * **A test submission cannot reach a prod endpoint** (Q3; task 067, criterion 1).
 *
 * The property comes out of the layout rather than from a check: `webhooks` is per
 * environment, so the deliverer running on `data_test` **cannot see a `data_prod.webhooks`
 * row at all**. There is no code path to assert the absence of, which is exactly why the
 * criterion asks for this against a real Postgres rather than for an argument: what makes
 * it true is two schemas and a search path, and the only way to be sure of those is to
 * have them.
 *
 * The shape below is a negative with a positive control beside it, because a negative
 * alone would pass against a deliverer that delivered nothing anywhere. So:
 *
 *   - a **production** endpoint exists for the form, and it is active;
 *   - a `response.submitted` event is enqueued in **`test`** and in `test` alone;
 *   - one pass runs over the whole live set;
 *   - and the production endpoint receives **no delivery row**, while a `test` endpoint
 *     added beside it receives one from the same event.
 *
 * The second clause is what gives the first its meaning: the pass did fan the event out,
 * to the endpoint in the event's own environment, and the production row was not merely
 * missed by a pass that did nothing.
 */
describe("a test submission cannot reach a prod endpoint (criterion 1)", () => {
  it("fans out inside the event's own environment and nowhere else", async () => {
    const { formId } = await seedForm("frm_no_cross_env_delivery");

    // The production endpoint. Active, so nothing about the absence below is a property
    // of a deactivated row.
    await insertWebhook(databases.for("prod"), {
      webhookId: "whk_prod_target",
      formId,
      url: "https://prod-consumer.example.com/hook",
      secretEncrypted: "not-a-real-secret",
    });
    // The positive control, in the event's own environment.
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
