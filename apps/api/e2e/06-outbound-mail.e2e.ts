import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { selectMailer } from "../src/features/email/smtp.js";
import { adminLink, signInLinkMessage } from "../src/features/email/templates.js";
import { recordingLogger } from "../src/test-support.js";
import {
  buildEnv,
  CONTAINER_BOOT_TIMEOUT_MS,
  startMailpit,
  type Mailpit,
} from "./support/index.js";

let mailpit: Mailpit;

beforeAll(async () => {
  mailpit = await startMailpit();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await mailpit?.stop();
});

beforeEach(async () => {
  await mailpit.clear();
});

function mailerFor(overrides: Record<string, string>) {
  const config = loadConfig(buildEnv({ ...mailpit.smtpEnv, ...overrides }));
  const { logger, lines } = recordingLogger();
  return { mailer: selectMailer(config, logger), lines, config };
}

describe("outbound email through a real SMTP relay", () => {
  it("delivers a sign-in link message to Mailpit", async () => {
    const { mailer, config } = mailerFor({});
    if (!config.mail.configured) throw new Error("mail should be configured");
    const link = adminLink(config.mail.linkBaseUrl, "/claim?token=e2e-claim-token");
    const to = "new.person@qcms.test";

    await expect(mailer.send(signInLinkMessage(to, "account-created", link))).resolves.toEqual({
      ok: true,
    });

    const received = await mailpit.waitForMessageTo(to);
    expect(received.From).toEqual({ Name: "QCMS", Address: "no-reply@qcms.test" });
    expect(received.To.map((recipient) => recipient.Address)).toEqual([to]);
    expect(received.Subject).toBe("Your QCMS account");
    expect(received.Text).toContain(link);
    expect(received.HTML).toContain(`href="${link}"`);
  });

  it("will not send through a relay that offers no STARTTLS when the upgrade is required", async () => {
    const { mailer, lines } = mailerFor({ QCMS_SMTP_SECURITY: "starttls" });
    const to = "downgrade@qcms.test";
    const link = "https://admin.example.test/claim?token=must-not-travel-in-clear";

    await expect(mailer.send(signInLinkMessage(to, "reset", link))).resolves.toEqual({
      ok: false,
      failure: "undeliverable",
    });
    expect(await mailpit.messagesTo(to)).toEqual([]);
    expect(JSON.stringify(lines)).not.toContain("must-not-travel-in-clear");
  });

  it("reports an unreachable relay as undeliverable without logging the link", async () => {
    const { mailer, lines } = mailerFor({ QCMS_SMTP_PORT: "1", QCMS_SMTP_TIMEOUT_MS: "2000" });
    const link = "https://admin.example.test/claim?token=unreachable-relay-token";

    await expect(
      mailer.send(signInLinkMessage("nobody@qcms.test", "reactivated", link)),
    ).resolves.toEqual({ ok: false, failure: "undeliverable" });
    const serialized = JSON.stringify(lines);
    expect(serialized).toContain("outbound mail send failed");
    expect(serialized).not.toContain("unreachable-relay-token");
    expect(serialized).not.toContain("nobody@qcms.test");
  });
});
