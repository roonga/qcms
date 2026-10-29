import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { Deps } from "../../src/deps.js";
import { runDeliveryPass } from "../../src/schedulers/outbox-delivery.js";

export interface CapturedRequest {
  readonly path: string;
  readonly method: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
  header(name: string): string | undefined;
}

export class WebhookReceiver {
  private server: Server | undefined;
  private port = 0;
  readonly received: CapturedRequest[] = [];

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
 * `now` defaults a minute ahead of the host clock so freshly enqueued rows are reliably
 * due despite Testcontainers clock skew.
 */
export function drainWebhooks(deps: Deps, now: Date = new Date(Date.now() + 60_000)) {
  return runDeliveryPass(deps, { now });
}

/** The recipe `docs/webhooks.md` publishes, over the raw timestamp header and body bytes. */
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
