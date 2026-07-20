import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig, MIN_SECRET_LENGTH } from "./config.js";
import { synthSecret, validEnv } from "./test-support.js";

describe("loadConfig - presence and shape (SEC-7, SEC-8)", () => {
  it("accepts a complete environment and parses mount + keys + flags", () => {
    const config = loadConfig(validEnv({ QCMS_MOUNT: "public,internal" }));
    expect(config.mount).toEqual({ public: true, internal: true, admin: false });
    expect(config.keys.link).toHaveLength(1);
    expect(config.keys.internal).toHaveLength(1);
    expect(config.flags.challengeProvider).toBe("none");
    expect(config.flags.adminTwoFactor).toBe("required");
    expect(config.challenge.provider).toBe("none");
  });

  it("QCMS_MOUNT=all mounts every surface", () => {
    expect(loadConfig(validEnv({ QCMS_MOUNT: "all" })).mount).toEqual({
      public: true,
      internal: true,
      admin: true,
    });
  });

  // Exit criterion 4: missing DATABASE_URL exits with a readable message.
  it("throws a readable ConfigError naming DATABASE_URL when it is missing", () => {
    let thrown: unknown;
    try {
      loadConfig(validEnv({ DATABASE_URL: undefined }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ConfigError);
    expect((thrown as ConfigError).message).toContain("DATABASE_URL");
    expect((thrown as ConfigError).message).toMatch(/required/i);
  });

  it("collects every problem in one throw", () => {
    let thrown: ConfigError | undefined;
    try {
      loadConfig({});
    } catch (err) {
      thrown = err as ConfigError;
    }
    expect(thrown).toBeInstanceOf(ConfigError);
    const message = thrown!.message;
    for (const name of [
      "DATABASE_URL",
      "QCMS_MOUNT",
      "QCMS_LINK_KEYS",
      "QCMS_SESSION_KEYS",
      "QCMS_INTERNAL_TOKEN",
      "QCMS_APP_KEY",
    ]) {
      expect(message).toContain(name);
    }
  });

  it("rejects secret material below the minimum length", () => {
    const short = "x".repeat(MIN_SECRET_LENGTH - 1);
    expect(() => loadConfig(validEnv({ QCMS_INTERNAL_TOKEN: short }))).toThrow(ConfigError);
  });

  it("parses a rotation list (first signs, all verify)", () => {
    const a = synthSecret();
    const b = synthSecret();
    const config = loadConfig(validEnv({ QCMS_INTERNAL_TOKEN: `${a}, ${b}` }));
    expect(config.keys.internal).toEqual([a, b]);
  });
});

// Task 024: portal base URL + webhook SSRF override.
describe("loadConfig - portal base URL and webhook targets (task 024)", () => {
  it("parses the portal base URL and defaults the SSRF override to false", () => {
    const config = loadConfig(validEnv());
    expect(config.portalBaseUrl).toBe("https://forms.example.test");
    expect(config.webhooks.allowPrivateTargets).toBe(false);
  });

  it("requires QCMS_PORTAL_BASE_URL", () => {
    expect(() => loadConfig(validEnv({ QCMS_PORTAL_BASE_URL: undefined }))).toThrow(ConfigError);
  });

  it("rejects a portal base URL that is not an absolute http(s) URL", () => {
    expect(() => loadConfig(validEnv({ QCMS_PORTAL_BASE_URL: "not-a-url" }))).toThrow(ConfigError);
    expect(() => loadConfig(validEnv({ QCMS_PORTAL_BASE_URL: "ftp://x.example" }))).toThrow(
      ConfigError,
    );
  });

  it("reads the webhook SSRF override flag", () => {
    expect(
      loadConfig(validEnv({ QCMS_WEBHOOK_ALLOW_PRIVATE: "true" })).webhooks.allowPrivateTargets,
    ).toBe(true);
    expect(() => loadConfig(validEnv({ QCMS_WEBHOOK_ALLOW_PRIVATE: "maybe" }))).toThrow(
      ConfigError,
    );
  });

  // Task 025: delivery timeout + batch size knobs.
  it("defaults the delivery timeout (10s) and batch size (20), and reads overrides", () => {
    const defaults = loadConfig(validEnv()).webhooks;
    expect(defaults.deliveryTimeoutMs).toBe(10_000);
    expect(defaults.deliveryBatchSize).toBe(20);

    const overridden = loadConfig(
      validEnv({ QCMS_WEBHOOK_TIMEOUT_MS: "3000", QCMS_WEBHOOK_BATCH_SIZE: "5" }),
    ).webhooks;
    expect(overridden.deliveryTimeoutMs).toBe(3000);
    expect(overridden.deliveryBatchSize).toBe(5);
  });

  it("rejects a delivery batch size below 1", () => {
    expect(() => loadConfig(validEnv({ QCMS_WEBHOOK_BATCH_SIZE: "0" }))).toThrow(ConfigError);
  });
});

// Exit criterion 6 (second half): config-failure output contains no secret values.
describe("SEC-8 redaction - errors never echo secret values", () => {
  it("names the offending var but never prints any secret value", () => {
    const secrets = {
      QCMS_LINK_KEYS: synthSecret(),
      QCMS_SESSION_KEYS: synthSecret(),
      QCMS_INTERNAL_TOKEN: synthSecret(),
      QCMS_APP_KEY: synthSecret(),
    };
    // Valid secrets, but DATABASE_URL missing → a boot failure that renders a message.
    let message = "";
    try {
      loadConfig(validEnv({ ...secrets, DATABASE_URL: undefined }));
    } catch (err) {
      message = (err as ConfigError).message;
    }
    expect(message).toContain("DATABASE_URL");
    for (const value of Object.values(secrets)) {
      expect(message).not.toContain(value);
    }
  });

  it("a too-short secret is reported by name and length, never by value", () => {
    const shortSecret = "s".repeat(MIN_SECRET_LENGTH - 5);
    let message = "";
    try {
      loadConfig(validEnv({ QCMS_APP_KEY: shortSecret }));
    } catch (err) {
      message = (err as ConfigError).message;
    }
    expect(message).toContain("QCMS_APP_KEY");
    expect(message).not.toContain(shortSecret);
  });
});

// Exit criterion 7: feature-flag registry (ADR-24).
describe("feature-flag registry (ADR-24)", () => {
  it("default challenge provider is none and requires no Turnstile secrets", () => {
    const config = loadConfig(validEnv());
    expect(config.flags.challengeProvider).toBe("none");
    expect(config.challenge).toEqual({ provider: "none" });
  });

  it("rejects an unknown QCMS_FLAG_* env at boot", () => {
    let message = "";
    try {
      loadConfig(validEnv({ QCMS_FLAG_MADE_UP: "1" }));
    } catch (err) {
      message = (err as ConfigError).message;
    }
    expect(message).toContain("QCMS_FLAG_MADE_UP");
    expect(message).toMatch(/not a known feature flag/i);
  });

  it("rejects a malformed flag value", () => {
    expect(() => loadConfig(validEnv({ QCMS_FLAG_CHALLENGE_PROVIDER: "recaptcha" }))).toThrow(
      ConfigError,
    );
  });

  it("QCMS_FLAG_CHALLENGE_PROVIDER=turnstile without secrets fails fast", () => {
    let message = "";
    try {
      loadConfig(validEnv({ QCMS_FLAG_CHALLENGE_PROVIDER: "turnstile" }));
    } catch (err) {
      message = (err as ConfigError).message;
    }
    expect(message).toContain("TURNSTILE_SITE_KEY");
    expect(message).toContain("TURNSTILE_SECRET_KEY");
  });

  it("turnstile with both secrets present parses the challenge config", () => {
    const config = loadConfig(
      validEnv({
        QCMS_FLAG_CHALLENGE_PROVIDER: "turnstile",
        TURNSTILE_SITE_KEY: "site-key",
        TURNSTILE_SECRET_KEY: "secret-key",
      }),
    );
    expect(config.flags.challengeProvider).toBe("turnstile");
    expect(config.challenge).toEqual({
      provider: "turnstile",
      turnstile: { siteKey: "site-key", secretKey: "secret-key" },
    });
  });

  it("QCMS_ADMIN_2FA folds into the registry (not QCMS_FLAG_ prefixed)", () => {
    expect(loadConfig(validEnv({ QCMS_ADMIN_2FA: "optional" })).flags.adminTwoFactor).toBe(
      "optional",
    );
    expect(() => loadConfig(validEnv({ QCMS_ADMIN_2FA: "sometimes" }))).toThrow(ConfigError);
  });
});
