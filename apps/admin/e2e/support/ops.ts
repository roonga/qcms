import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, type Page } from "@playwright/test";

import { buildEnv, composeApi, MOUNT, openDbHandle } from "../../../api/e2e/support/index.js";
import { createNullLogger } from "../../../api/src/logger.js";
import { runDeliveryPass } from "../../../api/src/schedulers/outbox-delivery.js";
import {
  API_BASE_URL,
  FIXED_APP_KEY,
  FIXED_INTERNAL_TOKEN,
} from "../../../portal/e2e/support/harness-config.js";
import { readFixtures } from "../../../portal/e2e/support/fixtures.js";

/**
 * Harness steps for the operations e2e (task 035): make real responses exist, run
 * real webhook deliveries, and stand up a real consumer to receive them.
 *
 * ## Why the responses are made over HTTP and not in the browser
 *
 * The arc under test is an **operator's**: browse, export, erase, operate deliveries.
 * The respondent half is 029/045's suite and is fully covered there, so driving the
 * portal through five steps to manufacture each fixture response would re-test their
 * ground at the cost of minutes per run. These calls go to the same composed API the
 * admin app talks to, over the same internal token, so what the operator screens then
 * read is real submitted data written by the real submission path (020) - including
 * the outbox event that makes the webhook half of the arc possible.
 *
 * ## Why the delivery pass runs in-process here
 *
 * Nothing in this suite runs the 017 scheduler: `api-server.ts` composes and serves
 * the app, it does not tick. That is right for the other specs (a background pass
 * firing mid-test is a flake generator) and it means this spec has to make the passes
 * itself. It composes its own `Deps` over the SAME database and the SAME app key
 * (`FIXED_APP_KEY` - the webhook secret is encrypted at rest under it, SEC-6) and
 * calls the product's own `runDeliveryPass`. Nothing about delivery is simulated: the
 * signing, the backoff, the dead-lettering and the redelivery are the shipped code.
 *
 * Passing an explicit `now` is what makes dead-lettering reachable at all. The backoff
 * schedule spans about forty hours before the tenth failure (`outbox.ts`), so a pass
 * driven by the wall clock would never make a second attempt inside a test run.
 */

/** A consumer that records what it received and answers however the test tells it to. */
export class TestConsumer {
  private server: Server | undefined;
  private port = 0;
  /** Every request the consumer received, oldest first. */
  readonly received: { readonly headers: Record<string, string>; readonly body: string }[] = [];
  /** The status every request is answered with. Change it to break the consumer. */
  status = 200;
  /** The body every request is answered with. */
  body = '{"ok":true}';

  async start(): Promise<void> {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(req.headers)) {
          headers[name] = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
        }
        this.received.push({ headers, body: Buffer.concat(chunks).toString("utf8") });
        res.writeHead(this.status, { "content-type": "application/json" });
        res.end(this.body);
      });
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(0, "127.0.0.1", () => {
        this.port = (this.server?.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  /** The URL a webhook should be pointed at to reach this consumer. */
  url(path = "/hook"): string {
    return `http://127.0.0.1:${String(this.port)}${path}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

/**
 * A loopback URL that nothing is listening on.
 *
 * Bind an ephemeral port, read it, release it. Connecting to it then fails at once
 * with a refused connection, which is a **deterministic** broken target - the "poison
 * the webhook target" half of the arc without a timeout's wall-clock cost. It is also
 * a private address, which is exactly why the harness runs with
 * `QCMS_WEBHOOK_ALLOW_PRIVATE`.
 */
export async function deadUrl(): Promise<string> {
  const probe = createServer();
  const port = await new Promise<number>((resolve) => {
    probe.listen(0, "127.0.0.1", () => {
      resolve((probe.address() as AddressInfo).port);
    });
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return `http://127.0.0.1:${String(port)}/gone`;
}

// --- making responses exist --------------------------------------------------

const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";

async function api(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const { token, ...rest } = init;
  return fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      [INTERNAL_TOKEN_HEADER]: FIXED_INTERNAL_TOKEN,
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(rest.headers as Record<string, string> | undefined),
    },
  });
}

/**
 * Submit one anonymous response to a form, through the real respondent routes.
 *
 * `answers` is applied in the order given, because the insurance fixture's later
 * questions are revealed by earlier ones (ADR-16's forward pass) and an answer to a
 * question that is not visible yet is refused. Returns the session id, which is what
 * every operator screen addresses a response by.
 */
export async function submitResponse(
  formSlug: string,
  answers: readonly (readonly [string, unknown])[],
): Promise<string> {
  const started = await api("/sessions", {
    method: "POST",
    body: JSON.stringify({ formSlug }),
  });
  expect(started.status, "starting a respondent session").toBe(201);
  const session = (await started.json()) as { sessionId: string; sessionToken: string };

  for (const [questionId, value] of answers) {
    const res = await api(`/sessions/${session.sessionId}/answers`, {
      method: "POST",
      token: session.sessionToken,
      body: JSON.stringify({ questionId, value }),
    });
    expect(res.status, `answering ${questionId}`).toBe(200);
  }

  const submitted = await api(`/sessions/${session.sessionId}/submit`, {
    method: "POST",
    token: session.sessionToken,
    body: JSON.stringify({}),
  });
  expect(submitted.status, "submitting the response").toBe(200);
  return session.sessionId;
}

/**
 * Change one already-answered question, so the ledger has more than one revision for
 * it (exit criterion 4 needs a session with a revised answer).
 *
 * Answers are append-only (R3): this writes a second row, it does not overwrite the
 * first, and the detail view's timeline is what proves that to an operator.
 */
export async function reviseAnswer(
  session: { sessionId: string; sessionToken: string },
  questionId: string,
  value: unknown,
): Promise<void> {
  const res = await api(`/sessions/${session.sessionId}/answers`, {
    method: "POST",
    token: session.sessionToken,
    body: JSON.stringify({ questionId, value }),
  });
  expect(res.status, `revising ${questionId}`).toBe(200);
}

/** Start a session and answer it without submitting, so the caller can revise first. */
export async function startSession(
  formSlug: string,
): Promise<{ sessionId: string; sessionToken: string }> {
  const started = await api("/sessions", {
    method: "POST",
    body: JSON.stringify({ formSlug }),
  });
  expect(started.status, "starting a respondent session").toBe(201);
  return (await started.json()) as { sessionId: string; sessionToken: string };
}

/** Submit a session the caller has been answering. */
export async function submitSession(session: {
  sessionId: string;
  sessionToken: string;
}): Promise<void> {
  const res = await api(`/sessions/${session.sessionId}/submit`, {
    method: "POST",
    token: session.sessionToken,
    body: JSON.stringify({}),
  });
  expect(res.status, "submitting the response").toBe(200);
}

// --- running delivery passes -------------------------------------------------

/** How far each attempt round advances the clock: past the longest backoff step (6h). */
const PASS_STRIDE_MS = 7 * 60 * 60 * 1000;

/**
 * A composed `Deps` over the run's database, for driving the deliverer.
 *
 * Built once per spec and closed at the end. `createNullLogger` because the pass logs
 * per-pass counts and this suite's server-log gate reads the API's capture file, not
 * this process's stdout.
 */
export function openDeliverer(): {
  pass: (at?: Date) => Promise<void>;
  drive: (passes: number) => Promise<void>;
  erasedDeliveries: () => Promise<{ deliveryId: string; sessionId: string }[]>;
  outboxPayloadsForSession: (sessionId: string) => Promise<Record<string, unknown>[]>;
  close: () => Promise<void>;
} {
  const fixtures = readFixtures();
  // A handle of this spec's own, over the run's database, built by the API harness so
  // the database client resolves from `apps/api` rather than from this package. Since
  // task 056 the admin declares no `pg`, `drizzle-orm` or `@qcms/db` dependency at all,
  // which is the point of the boundary and not merely tidiness.
  const { db, query, close: closePool } = openDbHandle(fixtures.databaseUrl);
  const env = buildEnv({
    DATABASE_URL: fixtures.databaseUrl,
    QCMS_INTERNAL_TOKEN: FIXED_INTERNAL_TOKEN,
    QCMS_APP_KEY: FIXED_APP_KEY,
    QCMS_MOUNT: "all",
  });
  const deps = composeApi(db, env, MOUNT.all, { logger: createNullLogger() }).deps;

  // Start an hour ahead of the host clock. The Testcontainers Postgres runs AHEAD of
  // the host, so a freshly written outbox row can carry a `next_attempt_at` in the
  // host's future and would not be claimed by a pass driven at `new Date()`.
  let clock = Date.now() + 60 * 60 * 1000;

  return {
    /** One pass at the current clock, without advancing it. */
    async pass(at?: Date) {
      await runDeliveryPass(deps, { now: at ?? new Date(clock) });
    },
    /**
     * Drive every due delivery through `rounds` attempt rounds. Eleven of them exhaust
     * the ten-attempt retry budget and dead-letter.
     *
     * The inner loop is what makes this reliable rather than approximately right. A
     * pass claims at most `QCMS_WEBHOOK_BATCH_SIZE` deliveries (20), and by the time
     * the whole browser suite has run there are far more outbox events than that
     * waiting for this form - so a fixed count of passes gives each delivery some
     * fraction of an attempt and nothing dead-letters. Running until a pass claims
     * nothing means "every delivery has had its attempt for this round", which is the
     * property the round count is counting.
     */
    async drive(rounds: number) {
      for (let round = 0; round < rounds; round += 1) {
        for (;;) {
          const metrics = await runDeliveryPass(deps, { now: new Date(clock) });
          if (metrics.claimed + metrics.materialized === 0) break;
        }
        clock += PASS_STRIDE_MS;
      }
    },
    /**
     * Every delivery in the database whose event names an **erased** session.
     *
     * The dead-letter table addresses rows by `data-delivery-id` and shows no session,
     * so a test that needs to avoid pressing an erased session's button has to resolve
     * the ids here rather than guess which row sorts first.
     *
     * A caller cannot assume there is exactly one. The whole browser suite shares a
     * database, more than one spec erases a response on the seeded form (the axe sweep
     * does it to photograph the tombstone state), and the gate capture erases one per
     * appearance mode. So "the erased one" is a set whose size depends on which specs
     * ran: computing it is what makes the redelivery assertions hold in isolation AND
     * inside the full run, and hard-coding one cost a green single-spec run and a red
     * suite.
     */
    async erasedDeliveries() {
      const result = await query<{ id: string; session_id: string }>(
        `select d.id, t.session_id
           from webhook_deliveries d
           join outbox o on o.id = d.outbox_id
           join erasure_tombstones t on t.session_id = o.payload ->> 'sessionId'`,
      );
      return result.rows.map((row) => ({ deliveryId: row.id, sessionId: row.session_id }));
    },
    /**
     * The raw outbox payloads queued for this session.
     *
     * Used to state as a test, rather than as prose, that erasure does NOT reach the
     * queued copy: the row survives with the locked answers still in it. That is the
     * fact the erase dialog now admits and the fact the redeliver refusal contains.
     */
    async outboxPayloadsForSession(sessionId: string) {
      const result = await query<{ payload: Record<string, unknown> }>(
        `select payload from outbox where payload ->> 'sessionId' = $1`,
        [sessionId],
      );
      return result.rows.map((row) => row.payload);
    },
    async close() {
      await closePool();
    },
  };
}

// --- browser steps -----------------------------------------------------------

/** Open a form's responses tab and wait for the browser to be on screen. */
export async function openResponses(page: Page, formId: string): Promise<void> {
  await page.goto(`/forms/${formId}/responses`);
  await expect(page.getByTestId("qcms-response-browser")).toBeVisible();
}

/** Open a form's webhooks tab and wait for the config to be on screen. */
export async function openWebhooks(page: Page, formId: string): Promise<void> {
  await page.goto(`/forms/${formId}/webhooks`);
  await expect(page.getByTestId("qcms-webhook-config")).toBeVisible();
}

/**
 * Deactivate every endpoint already configured on a form, through the real controls.
 *
 * The suite shares one database across every spec, and an earlier spec may have left an
 * endpoint on this form (the axe sweep configures one to photograph the secret reveal).
 * A second active endpoint doubles every fan-out, so a test that counts deliveries would
 * be counting another spec's as well - and a test that fixes ONE target would then find
 * half its queue still broken. Deactivating first makes this form's fan-out exactly one
 * endpoint wide, using the product's own control rather than a database reach-in.
 */
export async function deactivateExistingWebhooks(page: Page, formId: string): Promise<void> {
  await openWebhooks(page, formId);
  const table = page.getByTestId("qcms-webhooks-table");
  if ((await table.count()) === 0) return;
  for (;;) {
    const deactivate = table.getByRole("button", { name: "Deactivate", exact: true }).first();
    if ((await deactivate.count()) === 0) return;
    await deactivate.click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate it" }).click();
    await expect(deactivate).toHaveCount(0);
  }
}
