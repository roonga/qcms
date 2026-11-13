import { describe, expect, it } from "vitest";

import { loadConfig, type Config } from "../../config.js";
import { recordingLogger, validEnv } from "../../test-support.js";
import { unconfiguredMailer, type MailMessage } from "./mailer.js";
import {
  createNodemailerTransport,
  createSmtpMailer,
  selectMailer,
  type SmtpTransport,
} from "./smtp.js";
import { signInLinkMessage } from "./templates.js";

const RELAY = {
  QCMS_SMTP_HOST: "smtp.example.test",
  QCMS_SMTP_FROM: "QCMS <no-reply@example.test>",
};

const LINK = "https://admin.example.test/claim?token=single-use-claim-token-value";
const ADDRESS = "someone@example.test";

function mailConfig(overrides: Record<string, string> = {}) {
  const config = loadConfig(validEnv({ ...RELAY, ...overrides }));
  if (!config.mail.configured) throw new Error("mail is not configured");
  return config.mail;
}

function smtpError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function failingTransport(error: Error): SmtpTransport {
  return { sendMail: () => Promise.reject(error) };
}

describe("SMTP mailer", () => {
  it("hands the message to the transport from the configured sender", async () => {
    const sent: unknown[] = [];
    const mailer = createSmtpMailer(mailConfig(), recordingLogger().logger, () => ({
      sendMail: (mail) => {
        sent.push(mail);
        return Promise.resolve({});
      },
    }));
    const message = signInLinkMessage(ADDRESS, "account-created", LINK);

    expect(mailer.configured).toBe(true);
    await expect(mailer.send(message)).resolves.toEqual({ ok: true });
    expect(sent).toEqual([{ ...message, from: "QCMS <no-reply@example.test>" }]);
  });

  it("reports a refused recipient and a dead relay identically", async () => {
    const message: MailMessage = signInLinkMessage(ADDRESS, "reset", LINK);
    const refused = createSmtpMailer(mailConfig(), recordingLogger().logger, () =>
      failingTransport(smtpError("EENVELOPE", `550 5.1.1 <${ADDRESS}>: user unknown`)),
    );
    const unreachable = createSmtpMailer(mailConfig(), recordingLogger().logger, () =>
      failingTransport(smtpError("ECONNECTION", "connect ECONNREFUSED")),
    );

    const results = [await refused.send(message), await unreachable.send(message)];
    expect(results).toEqual([
      { ok: false, failure: "undeliverable" },
      { ok: false, failure: "undeliverable" },
    ]);
  });

  it("logs a transport failure by error class alone, never the link, address or reply", async () => {
    const { logger, lines } = recordingLogger();
    const mailer = createSmtpMailer(mailConfig(), logger, () =>
      failingTransport(
        smtpError("EMESSAGE", `rejected ${ADDRESS} with body ${LINK} from smtp.example.test`),
      ),
    );

    await mailer.send(signInLinkMessage(ADDRESS, "account-created", LINK));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: "outbound mail send failed", code: "EMESSAGE" });
    const serialized = JSON.stringify(lines);
    for (const leaked of [LINK, "single-use-claim-token-value", ADDRESS, "smtp.example.test"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("reduces an error code it does not recognise to a constant", async () => {
    const { logger, lines } = recordingLogger();
    const mailer = createSmtpMailer(mailConfig(), logger, () =>
      failingTransport(smtpError(ADDRESS, "odd")),
    );
    await mailer.send(signInLinkMessage(ADDRESS, "reset", LINK));
    expect(lines[0]).toMatchObject({ code: "EUNKNOWN" });
  });

  it("refuses every send while unconfigured", async () => {
    expect(unconfiguredMailer.configured).toBe(false);
    await expect(
      unconfiguredMailer.send(signInLinkMessage(ADDRESS, "reset", LINK)),
    ).resolves.toEqual({ ok: false, failure: "not-configured" });
  });

  it("selects the SMTP mailer only when mail is configured", () => {
    const logger = recordingLogger().logger;
    const unconfigured: Pick<Config, "mail"> = { mail: { configured: false } };
    expect(selectMailer(unconfigured, logger)).toBe(unconfiguredMailer);
    expect(selectMailer({ mail: mailConfig() }, logger).configured).toBe(true);
  });
});

describe("nodemailer transport options", () => {
  function optionsFor(overrides: Record<string, string>): Record<string, unknown> {
    const transport = createNodemailerTransport(mailConfig(overrides).smtp) as unknown as {
      options: Record<string, unknown>;
    };
    return transport.options;
  }

  it("requires the STARTTLS upgrade by default and keeps the protocol log off", () => {
    expect(optionsFor({})).toMatchObject({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
      logger: false,
      debug: false,
    });
  });

  it("uses implicit TLS for `tls` and no TLS only for the development relay", () => {
    expect(optionsFor({ QCMS_SMTP_SECURITY: "tls" })).toMatchObject({
      secure: true,
      requireTLS: false,
    });
    expect(
      optionsFor({ QCMS_SMTP_SECURITY: "none", QCMS_SMTP_ALLOW_INSECURE: "true" }),
    ).toMatchObject({ secure: false, requireTLS: false, ignoreTLS: true });
  });
});
