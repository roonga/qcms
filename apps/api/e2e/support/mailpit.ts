// Loaded first for its side effect: it neutralises the Docker credential helper before
// Testcontainers reads the auth config.
import { CONTAINER_BOOT_TIMEOUT_MS } from "@roonga/qcms-db/testing";

/** Matches the e2e Compose overlay; `QCMS_TEST_MAILPIT_IMAGE` points at a mirror. */
export const DEFAULT_TEST_MAILPIT_IMAGE = "axllent/mailpit:v1.33.1";

const SMTP_PORT = 1025;
const HTTP_PORT = 8025;

export interface MailpitAddress {
  readonly Address: string;
  readonly Name: string;
}

export interface MailpitMessage {
  readonly ID: string;
  readonly From: MailpitAddress;
  readonly To: readonly MailpitAddress[];
  readonly Subject: string;
  readonly Text: string;
  readonly HTML: string;
}

interface MailpitSummaryList {
  readonly messages: readonly { readonly ID: string }[];
}

export interface Mailpit {
  /** `QCMS_SMTP_*` settings that point the API at this relay over plaintext SMTP. */
  readonly smtpEnv: Readonly<Record<string, string>>;
  readonly smtpHost: string;
  readonly smtpPort: number;
  /** Every message whose recipients include the address, newest first. */
  messagesTo(address: string): Promise<MailpitMessage[]>;
  /** Polls until a message to the address arrives, or throws after the timeout. */
  waitForMessageTo(address: string, timeoutMs?: number): Promise<MailpitMessage>;
  clear(): Promise<void>;
  stop(): Promise<void>;
}

export { CONTAINER_BOOT_TIMEOUT_MS };

export async function startMailpit(): Promise<Mailpit> {
  const { GenericContainer, Wait } = await import("testcontainers");
  const image = process.env.QCMS_TEST_MAILPIT_IMAGE?.trim() || DEFAULT_TEST_MAILPIT_IMAGE;
  const container = await new GenericContainer(image)
    .withExposedPorts(SMTP_PORT, HTTP_PORT)
    .withWaitStrategy(Wait.forHttp("/readyz", HTTP_PORT).forStatusCode(200))
    .withStartupTimeout(CONTAINER_BOOT_TIMEOUT_MS - 30_000)
    .start();

  const smtpHost = container.getHost();
  const smtpPort = container.getMappedPort(SMTP_PORT);
  const api = `http://${smtpHost}:${String(container.getMappedPort(HTTP_PORT))}/api/v1`;

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${api}${path}`, init);
    if (!response.ok) throw new Error(`Mailpit ${path} answered ${String(response.status)}`);
    return (await response.json()) as T;
  }

  async function messagesTo(address: string): Promise<MailpitMessage[]> {
    const query = encodeURIComponent(`to:"${address}"`);
    const list = await json<MailpitSummaryList>(`/search?query=${query}`);
    return Promise.all(list.messages.map((m) => json<MailpitMessage>(`/message/${m.ID}`)));
  }

  return {
    smtpEnv: {
      QCMS_SMTP_HOST: smtpHost,
      QCMS_SMTP_PORT: String(smtpPort),
      QCMS_SMTP_SECURITY: "none",
      QCMS_SMTP_ALLOW_INSECURE: "true",
      QCMS_SMTP_FROM: "QCMS <no-reply@qcms.test>",
    },
    smtpHost,
    smtpPort,
    messagesTo,
    async waitForMessageTo(address, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const [newest] = await messagesTo(address);
        if (newest !== undefined) return newest;
        if (Date.now() > deadline) throw new Error(`no message to ${address} reached Mailpit`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    },
    async clear() {
      const response = await fetch(`${api}/messages`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Mailpit clear answered ${String(response.status)}`);
    },
    async stop() {
      await container.stop();
    },
  };
}
