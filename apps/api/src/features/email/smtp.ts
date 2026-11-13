import nodemailer from "nodemailer";

import type { Config, MailConfig } from "../../config.js";
import type { Logger } from "../../logger.js";
import { unconfiguredMailer, type Mailer, type MailMessage } from "./mailer.js";

type ConfiguredMail = Extract<MailConfig, { configured: true }>;

interface OutgoingMail extends MailMessage {
  readonly from: string;
}

/** The slice of a nodemailer transporter the mailer uses, so tests can stand in for SMTP. */
export interface SmtpTransport {
  sendMail(mail: OutgoingMail): Promise<unknown>;
}

export type SmtpTransportFactory = (config: ConfiguredMail["smtp"]) => SmtpTransport;

export const createNodemailerTransport: SmtpTransportFactory = (smtp) =>
  nodemailer.createTransport(
    {
      host: smtp.host,
      port: smtp.port,
      secure: smtp.security === "tls",
      requireTLS: smtp.security === "starttls",
      ignoreTLS: smtp.security === "none",
      ...(smtp.auth !== undefined ? { auth: { user: smtp.auth.user, pass: smtp.auth.password } } : {}),
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: smtp.timeoutMs,
      greetingTimeout: smtp.timeoutMs,
      socketTimeout: smtp.timeoutMs,
      // The protocol log would carry each message, and with it the sign-in link.
      logger: false,
      debug: false,
    },
    { disableFileAccess: true, disableUrlAccess: true },
  );

const ERROR_CODE = /^E[A-Z]{2,20}$/;

/** Only nodemailer's own error class is logged: its message can quote the recipient or the server's reply. */
function errorCode(error: unknown): string {
  const code: unknown =
    error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && ERROR_CODE.test(code) ? code : "EUNKNOWN";
}

export function createSmtpMailer(
  mail: ConfiguredMail,
  logger: Logger,
  createTransport: SmtpTransportFactory = createNodemailerTransport,
): Mailer {
  const transport = createTransport(mail.smtp);
  return {
    configured: true,
    async send(message) {
      try {
        await transport.sendMail({ ...message, from: mail.from });
        return { ok: true };
      } catch (error: unknown) {
        logger.warn("outbound mail send failed", { code: errorCode(error) });
        return { ok: false, failure: "undeliverable" };
      }
    },
  };
}

export function selectMailer(config: Pick<Config, "mail">, logger: Logger): Mailer {
  return config.mail.configured ? createSmtpMailer(config.mail, logger) : unconfiguredMailer;
}
