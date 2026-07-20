/**
 * Live-DB integration (task 017, exit criterion 5 second half + criterion 1
 * happy path). Boots the 013 Testcontainers harness and proves:
 *
 * - the retention-sweep scheduler, on a short interval, actually expires an
 *   abandoned session in the real database; and
 * - `/ready` returns 200 against a reachable database.
 *
 * Requires Docker (like every `*.integration.test.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FormId, SessionId, type FormDefinition } from "@qcms/core";
import { createForm, createSession, getSession, insertFormVersion } from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";

import { createApp } from "../app.js";
import { systemClock } from "../clock.js";
import { loadConfig, type Config } from "../config.js";
import { createRetentionSweepScheduler } from "./retention-sweep.js";
import { makeDeps, validEnv } from "../test-support.js";

const BOOT_TIMEOUT = 120_000;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
}, BOOT_TIMEOUT);

/** Seed a form + one published version so a session has valid FKs. */
async function seedForm(id: string): Promise<{ formId: FormId; version: number }> {
  const formId = FormId.parse(id);
  await createForm(testDb.db, { formId, slug: `${id}-slug`, defaultLocale: "en" });
  const v = await insertFormVersion(testDb.db, {
    formId,
    // Empty def/compiled: the sweep only reads session status/expiry, never form
    // content. Cast the whole input so the test needn't import @qcms/a2ui-compiler.
    definition: {} as unknown as FormDefinition,
    compiled: {},
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  } as unknown as Parameters<typeof insertFormVersion>[1]);
  return { formId, version: v.version };
}

/** Build a config whose retention sweep runs on a short test interval. */
function shortIntervalConfig(intervalMs: number): Config {
  const base = loadConfig(validEnv());
  return {
    ...base,
    scheduler: { ...base.scheduler, retentionSweepIntervalMs: intervalMs },
  };
}

describe("retention-sweep scheduler (live DB)", () => {
  it("expires an abandoned session on a short interval", async () => {
    const { formId, version } = await seedForm("frm_api_sweep");
    const abandoned = SessionId.parse("ses_api_sweep");
    await createSession(testDb.db, {
      sessionId: abandoned,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() - 60_000), // already past → sweepable
    });
    expect((await getSession(testDb.db, abandoned))?.status).toBe("created");

    // System clock: the session's expiry is set relative to real `Date.now()`,
    // so the sweep must compare against real time, not a frozen test clock.
    const deps = makeDeps({ db: testDb.db, config: shortIntervalConfig(25), clock: systemClock });
    const scheduler = createRetentionSweepScheduler(deps);
    scheduler.start();
    try {
      const deadline = Date.now() + 4_000;
      let status: string | undefined;
      while (Date.now() < deadline) {
        status = (await getSession(testDb.db, abandoned))?.status;
        if (status === "expired") break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(status).toBe("expired");
    } finally {
      await scheduler.stop();
    }
    // Graceful stop leaves the scheduler idle.
    expect(scheduler.running).toBe(false);
  }, 15_000);
});

describe("/ready against a reachable database (exit criterion 1 happy path)", () => {
  it("returns 200 ready when the DB responds", async () => {
    const deps = makeDeps({ db: testDb.db });
    const app = createApp(deps, { public: true, internal: true, admin: true });
    const res = await app.request("/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready", checks: { db: "ok" } });
  });
});
