/**
 * Webhook receiver + delivery helpers for the e2e suite (task 027).
 *
 * A scenario proves the *whole* webhook path: a real loopback HTTP receiver
 * stands in for a consumer, the delivery pass (the same one `serve.ts`'s
 * scheduler runs) signs and POSTs to it, and the scenario verifies the signature
 * with the documented recipe. This is composition-level wiring (the scheduler is
 * not a slice), kept here so scenarios stay pure HTTP + support utilities.
 *
 * Test code, so `node:*` is fair game (the R4 fetch-purity rule governs product
 * handlers, not the harness).
 */

import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { Deps } from "../../src/deps.js";
import { runDeliveryPass } from "../../src/schedulers/outbox-delivery.js";

/** One captured inbound delivery. */
export interface CapturedRequest {
  readonly path: string;
  readonly method: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
  header(name: string): string | undefined;
}

/** An in-test HTTP server that captures the webhook POSTs delivered to it. */
export class WebhookReceiver {
  private server: Server | undefined;
  private port = 0;
  readonly received: CapturedRequest[] = [];

  /** Start listening on an ephemeral loopback port. */
  async start(): Promise<void> {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const headers = req.headers;
        this.received.push({
          path: req.url ?? "/",
          method: req.method ?? "GET",
          headers,
          body,
          header: (name) => {
            const v = headers[name.toLowerCase()];
            return Array.isArray(v) ? v[0] : v;
          },
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => {
      this.server!.listen(0, "127.0.0.1", () => {
        this.port = (this.server!.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  /** The absolute loopback URL for a path (a valid private/http webhook target). */
  url(path = "/hook"): string {
    return `http://127.0.0.1:${this.port}${path}`;
  }

  reset(): void {
    this.received.length = 0;
  }

  async stop(): Promise<void> {
    if (this.server === undefined) return;
    await new Promise<void>((resolve, reject) =>
      this.server!.close((err) => (err ? reject(err) : resolve())),
    );
    this.server = undefined;
  }
}

/**
 * Run one delivery pass - materialize due outbox events into per-webhook delivery
 * rows and POST them. `now` defaults a minute ahead of the host clock so freshly
 * enqueued rows are reliably "due" despite Testcontainers clock skew.
 */
export function drainWebhooks(deps: Deps, now: Date = new Date(Date.now() + 60_000)) {
  return runDeliveryPass(deps, { now });
}

/**
 * Verify a delivered signature with the documented recipe (docs/webhooks.md):
 * `v1=<hex HMAC-SHA256(secret, `${timestamp}.${body}`)>`, over the exact received
 * timestamp header and raw body bytes.
 */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const expected = `v1=${digest}`;
  return expected === signature;
}
