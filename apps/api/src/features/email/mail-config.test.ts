import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig, type Config } from "../../config.js";
import { validEnv } from "../../test-support.js";

const RELAY = {
  QCMS_SMTP_HOST: "smtp.example.test",
  QCMS_SMTP_FROM: "QCMS <no-reply@example.test>",
};

function issuesFor(overrides: Record<string, string | undefined>): string {
  try {
    loadConfig(validEnv(overrides));
  } catch (error) {
    if (error instanceof ConfigError) return error.message;
    throw error;
  }
  return "";
}

function configuredMail(config: Config): Extract<Config["mail"], { configured: true }> {
  if (!config.mail.configured) throw new Error("mail is not configured");
  return config.mail;
}

describe("QCMS_SMTP_* configuration", () => {
  it("leaves mail unconfigured when no relay is named", () => {
    expect(loadConfig(validEnv()).mail).toEqual({ configured: false });
  });

  it("defaults to STARTTLS on 587 and links to the admin origin", () => {
    const mail = configuredMail(loadConfig(validEnv(RELAY)));
    expect(mail.smtp).toMatchObject({
      host: "smtp.example.test",
      port: 587,
      security: "starttls",
      auth: undefined,
    });
    expect(mail.from).toBe("QCMS <no-reply@example.test>");
    expect(mail.linkBaseUrl).toBe("https://admin.example.test");
  });

  it("defaults implicit TLS to 465 and honours an explicit port", () => {
    expect(
      configuredMail(loadConfig(validEnv({ ...RELAY, QCMS_SMTP_SECURITY: "tls" }))).smtp.port,
    ).toBe(465);
    expect(
      configuredMail(loadConfig(validEnv({ ...RELAY, QCMS_SMTP_PORT: "2525" }))).smtp.port,
    ).toBe(2525);
  });

  it("refuses non-TLS SMTP unless the development opt-in is set", () => {
    expect(issuesFor({ ...RELAY, QCMS_SMTP_SECURITY: "none" })).toContain(
      "QCMS_SMTP_SECURITY=none sends mail and its sign-in links unencrypted and is refused outside development",
    );
    const mail = configuredMail(
      loadConfig(
        validEnv({ ...RELAY, QCMS_SMTP_SECURITY: "none", QCMS_SMTP_ALLOW_INSECURE: "true" }),
      ),
    );
    expect(mail.smtp.security).toBe("none");
  });

  it("refuses credentials over a plaintext relay even in development", () => {
    expect(
      issuesFor({
        ...RELAY,
        QCMS_SMTP_SECURITY: "none",
        QCMS_SMTP_ALLOW_INSECURE: "true",
        QCMS_SMTP_USER: "relay-user",
        QCMS_SMTP_PASSWORD: "relay-password-value",
      }),
    ).toContain("refused with QCMS_SMTP_SECURITY=none");
  });

  it("refuses an unknown security mode", () => {
    expect(issuesFor({ ...RELAY, QCMS_SMTP_SECURITY: "ssl" })).toContain(
      "QCMS_SMTP_SECURITY must be one of: starttls, tls, none",
    );
  });

  it("requires a sender, on one line", () => {
    expect(issuesFor({ QCMS_SMTP_HOST: "smtp.example.test" })).toContain(
      "QCMS_SMTP_FROM is required",
    );
    expect(
      issuesFor({ ...RELAY, QCMS_SMTP_FROM: "a@example.test\r\nBcc: b@example.test" }),
    ).toContain("QCMS_SMTP_FROM must be an address");
    expect(issuesFor({ ...RELAY, QCMS_SMTP_FROM: "not an address" })).toContain(
      "QCMS_SMTP_FROM must be an address",
    );
  });

  it("requires the user and password together and never echoes the password", () => {
    const password = "a-distinctive-relay-password";
    const message = issuesFor({ ...RELAY, QCMS_SMTP_PASSWORD: password });
    expect(message).toContain("QCMS_SMTP_USER and QCMS_SMTP_PASSWORD must be set together");
    expect(message).not.toContain(password);
    const mail = configuredMail(
      loadConfig(validEnv({ ...RELAY, QCMS_SMTP_USER: "relay", QCMS_SMTP_PASSWORD: password })),
    );
    expect(mail.smtp.auth).toEqual({ user: "relay", password });
  });

  it("refuses an example-file placeholder password", () => {
    expect(
      issuesFor({
        ...RELAY,
        QCMS_SMTP_USER: "relay",
        QCMS_SMTP_PASSWORD: "replace-with-the-relay-password",
      }),
    ).toContain("QCMS_SMTP_PASSWORD still holds 1 placeholder value(s)");
  });

  it("names the relay as missing when only other settings are present", () => {
    expect(issuesFor({ QCMS_SMTP_FROM: "no-reply@example.test" })).toContain(
      "QCMS_SMTP_HOST is required when QCMS_SMTP_FROM is set",
    );
  });

  it("stays unconfigured where the admin surface is not mounted", () => {
    expect(loadConfig(validEnv({ ...RELAY, QCMS_MOUNT: "public,internal" })).mail).toEqual({
      configured: false,
    });
  });
});
