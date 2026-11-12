import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, type Locator, type Page } from "@playwright/test";

import { buildEnv, composeApi, MOUNT, openDbHandle } from "../../../api/e2e/support/index.js";
import { createNullLogger } from "../../../api/src/logger.js";
import { runDeliveryPass } from "../../../api/src/schedulers/outbox-delivery.js";
import {
  API_BASE_URL,
  FIXED_APP_KEY,
  FIXED_INTERNAL_TOKEN,
} from "../../../portal/e2e/support/harness-config.js";
import { readFixtures } from "../../../portal/e2e/support/fixtures.js";

import { openMenu } from "./flow.js";
import { waitForHydration } from "./hydration.js";

// Seed respondent data through the composed API; the operator journey does not need to repeat portal UI coverage.
// The harness has no background scheduler, so tests run real delivery passes with an explicit clock.

export class TestConsumer {
  private server: Server | undefined;
  private port = 0;
  readonly received: { readonly headers: Record<string, string>; readonly body: string }[] = [];
  status = 200;
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

// A released loopback port fails promptly; the harness permits private webhook targets for these fixtures.
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

// Answer in order: later questions may only become visible after earlier answers.
export async function submitResponse(
  formSlug: string,
  answers: readonly (readonly [string, unknown])[],
  options: {
    // Read the configured decoy name from openDeliverer. Flagged submissions stay silent and enqueue no outbox event.
    readonly honeypotField?: string;
  } = {},
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
    body: JSON.stringify(
      options.honeypotField === undefined ? {} : { [options.honeypotField]: "bot" },
    ),
  });
  expect(submitted.status, "submitting the response").toBe(200);
  return session.sessionId;
}

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

// Advance beyond the longest delivery backoff so every failed delivery becomes due next round.
const PASS_STRIDE_MS = 7 * 60 * 60 * 1000;

// Bound a queue that keeps rearming so a scheduler regression fails instead of hanging the suite.
const MAX_SWEEP_PASSES = 200;

// Use a form with no endpoint so planted backlog consumes claim slots without creating deliveries or dead letters.
const BACKLOG_FORM_ID = "frm_e2e_backlog_pin";

export function openDeliverer(): {
  // Read the decoy name from the composed configuration; do not duplicate the compiler contract.
  honeypotField: string;
  pass: (at?: Date) => Promise<void>;
  sweep: (at?: Date) => Promise<number>;
  plantBacklog: (count: number) => Promise<void>;
  drive: (passes: number) => Promise<void>;
  erasedDeliveries: () => Promise<{ deliveryId: string; sessionId: string }[]>;
  cancelledDeliveries: (
    sessionId: string,
  ) => Promise<{ deliveryId: string; cancelledReason: string | null }[]>;
  outboxPayloadsForSession: (sessionId: string) => Promise<Record<string, unknown>[]>;
  close: () => Promise<void>;
} {
  const fixtures = readFixtures();
  // Resolve the database client through the API harness; the admin workspace owns no database dependency.
  const { db, query, close: closePool } = openDbHandle(fixtures.databaseUrl);
  const env = buildEnv({
    DATABASE_URL: fixtures.databaseUrl,
    QCMS_ENVIRONMENTS: "test,prod",
    QCMS_DATABASE_URL_TEST: fixtures.databaseUrl,
    QCMS_DATABASE_URL_PROD: fixtures.databaseUrl,
    QCMS_INTERNAL_TOKEN: FIXED_INTERNAL_TOKEN,
    QCMS_APP_KEY: FIXED_APP_KEY,
    QCMS_MOUNT: "all",
  });
  const deps = composeApi(db, env, MOUNT.all, { logger: createNullLogger() }).deps;

  // The database clock can lead the host; start ahead so newly queued events are already due.
  let clock = Date.now() + 60 * 60 * 1000;

  // Keep this predicate aligned with claimDue: delivery metrics do not count consumed outbox events.
  async function dueOutboxEvents(now: Date): Promise<number> {
    const rows = await query<{ due: string }>(
      `select count(*) as due
         from outbox
        where delivered_at is null
          and dead_lettered_at is null
          and payload_redacted_at is null
          and next_attempt_at <= $1`,
      [now],
    );
    return Number(rows.rows[0]?.due ?? 0);
  }

  async function sweepAt(now: Date): Promise<number> {
    for (let passes = 1; passes <= MAX_SWEEP_PASSES; passes += 1) {
      const metrics = await runDeliveryPass(deps, { now });
      const due = await dueOutboxEvents(now);
      if (due === 0 && metrics.claimed + metrics.materialized === 0) return passes;
    }
    throw new Error(
      `a delivery sweep did not settle in ${String(MAX_SWEEP_PASSES)} passes; ` +
        `something is re-arming the queue at a fixed instant`,
    );
  }

  return {
    honeypotField: deps.config.antiAbuse.honeypotField,
    // Only one batch. Use sweep when all due events must get an attempt.
    async pass(at?: Date) {
      await runDeliveryPass(deps, { now: at ?? new Date(clock) });
    },
    // Drain all due outbox events at one instant, including events that fan out to no endpoint.
    // Metrics can report zero for consumed events; query the queue itself.
    // Keeping now fixed prevents a failed delivery from being attempted twice in one round.
    async sweep(at?: Date) {
      return sweepAt(at ?? new Date(clock));
    },
    // Older events must sort ahead of the caller's rows to exercise a backlog larger than one batch.
    // The fixture form has no endpoint, so consuming these events adds no delivery rows.
    async plantBacklog(count: number) {
      await query(
        `insert into outbox (event_type, payload, next_attempt_at)
         select 'response.submitted',
                jsonb_build_object('formId', $2::text, 'sessionId', 'ses_backlog'),
                now() - interval '1 day'
           from generate_series(1, $1::int)`,
        [count, BACKLOG_FORM_ID],
      );
    },
    // Sweep once per round so every due delivery is attempted even when the backlog exceeds one batch.
    async drive(rounds: number) {
      for (let round = 0; round < rounds; round += 1) {
        await sweepAt(new Date(clock));
        clock += PASS_STRIDE_MS;
      }
    },
    // Erased sessions may have no delivery rows when erasure redacted the payload before fan-out.
    async erasedDeliveries() {
      const result = await query<{ id: string; session_id: string }>(
        `select d.id, t.session_id
           from webhook_deliveries d
           join outbox o on o.id = d.outbox_id
           join erasure_tombstones t on t.session_id = o.payload ->> 'sessionId'`,
      );
      return result.rows.map((row) => ({ deliveryId: row.id, sessionId: row.session_id }));
    },
    // Inspect persisted cancellation fields: the scheduler and redelivery guard depend on them, not the rendered badge.
    async cancelledDeliveries(sessionId: string) {
      const result = await query<{ id: string; cancelled_reason: string | null }>(
        `select d.id, d.cancelled_reason
           from webhook_deliveries d
           join outbox o on o.id = d.outbox_id
          where o.payload ->> 'sessionId' = $1
            and d.cancelled_at is not null`,
        [sessionId],
      );
      return result.rows.map((row) => ({
        deliveryId: row.id,
        cancelledReason: row.cancelled_reason,
      }));
    },
    // Erasure must retain the outbox envelope while removing its answers.
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

export const ERASE_ITEM = "Erase respondent data…";

/** The response's erase door: the page header's menu. Absent when the caller holds no erase cell. */
export function moreActions(page: Page): Locator {
  return page.getByRole("button", { name: "More actions" });
}

export async function openEraseDialog(page: Page): Promise<void> {
  await openMenu(moreActions(page));
  await page.getByRole("menuitem", { name: ERASE_ITEM }).click();
}

export async function openResponses(page: Page, formId: string): Promise<void> {
  await page.goto(`/operations/forms/${formId}/responses`);
  await expect(page.getByTestId("qcms-response-browser")).toBeVisible();
  await waitForHydration(page);
}

export async function openWebhooks(page: Page, formId: string): Promise<void> {
  await page.goto(`/operations/forms/${formId}/webhooks`);
  await expect(page.getByTestId("qcms-webhook-config")).toBeVisible();
}

// The database is shared: existing endpoints would multiply fan-out and invalidate delivery-count assertions.
export async function deactivateExistingWebhooks(page: Page, formId: string): Promise<void> {
  await openWebhooks(page, formId);
  await waitForHydration(page);
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
