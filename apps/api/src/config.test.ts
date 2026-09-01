import { describe, expect, it } from "vitest";

import { DEFAULT_RESPONSE_SNIPPET_RETENTION_MS } from "@qcms/db";

import {
  challengeEnforceable,
  ConfigError,
  loadConfig,
  MIN_SECRET_LENGTH,
  turnstileSiteKeyDeprecationWarning,
} from "./config.js";
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

  /**
   * Trailing-slash normalization, which nothing tested until issue #328.
   *
   * This is not a config nit. `adminAuth.baseUrl` reaches better-auth as its `baseURL`
   * and its `trustedOrigins`, and better-auth compares a trusted origin by exact string
   * equality against `new URL(url).origin` - which never carries a trailing slash. So
   * `QCMS_ADMIN_BASE_URL=https://admin.example/` would make `trustedOrigins` match
   * nothing and the origin check would reject every state-changing better-auth POST:
   * sign-in, TOTP verification, recovery-code use, sign-out. Admin authentication would
   * be dead on arrival for an operator who typed one extra character, with a CSRF
   * rejection as the only clue.
   *
   * Asserted as **the property the consumer depends on** (`value === new URL(value).origin`)
   * rather than as "one slash gets stripped", because equality with the origin is what
   * better-auth actually computes.
   */
  it.each([
    ["https://forms.example.test/", "https://forms.example.test"],
    ["https://forms.example.test///", "https://forms.example.test"],
    ["  https://forms.example.test/  ", "https://forms.example.test"],
  ])("normalizes the portal base URL %s away from its trailing slash", (raw, expected) => {
    const parsed = loadConfig(validEnv({ QCMS_PORTAL_BASE_URL: raw })).portalBaseUrl;
    expect(parsed).toBe(expected);
    expect(parsed).toBe(new URL(parsed).origin);
  });

  it.each([
    ["https://admin.example.test/", "https://admin.example.test"],
    ["https://admin.example.test///", "https://admin.example.test"],
    ["  https://admin.example.test/  ", "https://admin.example.test"],
  ])(
    "normalizes the admin base URL %s, which better-auth compares by equality",
    (raw, expected) => {
      const parsed = loadConfig(validEnv({ QCMS_ADMIN_BASE_URL: raw })).adminAuth.baseUrl;
      expect(parsed).toBe(expected);
      expect(parsed).toBe(new URL(parsed).origin);
    },
  );

  it("leaves a base URL that carries a path alone, slash or no slash", () => {
    // Only the trailing slash is normalized: a deployment mounted under a path prefix is
    // a different shape, and silently rewriting it would be a worse defect than the one
    // being guarded. `origin` is deliberately NOT asserted here.
    expect(
      loadConfig(validEnv({ QCMS_PORTAL_BASE_URL: "https://x.example/forms" })).portalBaseUrl,
    ).toBe("https://x.example/forms");
    expect(
      loadConfig(validEnv({ QCMS_PORTAL_BASE_URL: "https://x.example/forms/" })).portalBaseUrl,
    ).toBe("https://x.example/forms");
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

  it("a malformed QCMS_ADMIN_AUTH_SECRETS entry is reported by position, never by value", () => {
    // Every refusal path in one value: a missing separator, a non-numeric version, a
    // repeated version and a too-short secret. This is the SEC-8 trap the parser exists
    // to avoid - better-auth's own `parseSecretsEnv` quotes the offending entry back
    // (`dist/context/secret-utils.mjs`), and that entry is a secret.
    const good = synthSecret();
    const noSeparator = synthSecret();
    const badVersion = synthSecret();
    const duplicate = synthSecret();
    const tooShort = "s".repeat(MIN_SECRET_LENGTH - 5);
    let message = "";
    try {
      loadConfig(
        validEnv({
          QCMS_ADMIN_AUTH_SECRETS: [
            `3:${good}`,
            noSeparator,
            `x:${badVersion}`,
            `3:${duplicate}`,
            `2:${tooShort}`,
          ].join(","),
          DATABASE_URL: undefined,
        }),
      );
    } catch (err) {
      message = (err as ConfigError).message;
    }
    expect(message).toContain("QCMS_ADMIN_AUTH_SECRETS");
    for (const value of [good, noSeparator, badVersion, duplicate, tooShort]) {
      expect(message).not.toContain(value);
    }
  });
});

describe("QCMS_ADMIN_AUTH_SECRETS - versioned auth-secret rotation (issue #319)", () => {
  it("defaults to one version-1 entry holding QCMS_ADMIN_AUTH_SECRET", () => {
    const secret = synthSecret();
    const config = loadConfig(validEnv({ QCMS_ADMIN_AUTH_SECRET: secret }));
    // The default is what makes the versioned envelope the normal case rather than
    // something a deployment opts into, while signing with exactly the value it always
    // signed with.
    expect(config.adminAuth.secret).toBe(secret);
    expect(config.adminAuth.secrets).toEqual([{ version: 1, value: secret }]);
  });

  it("parses a rotation list, first entry current, older versions kept for reading", () => {
    const next = synthSecret();
    const previous = synthSecret();
    const config = loadConfig(
      validEnv({
        QCMS_ADMIN_AUTH_SECRET: previous,
        QCMS_ADMIN_AUTH_SECRETS: ` 2:${next} , 1:${previous} `,
      }),
    );
    expect(config.adminAuth.secrets).toEqual([
      { version: 2, value: next },
      { version: 1, value: previous },
    ]);
    // `secret` is untouched by the list: better-auth keeps it as the legacy fallback
    // for ciphertext written before the envelope existed.
    expect(config.adminAuth.secret).toBe(previous);
  });

  it("refuses a repeated version rather than silently preferring one", () => {
    expect(() =>
      loadConfig(validEnv({ QCMS_ADMIN_AUTH_SECRETS: `1:${synthSecret()},1:${synthSecret()}` })),
    ).toThrow(ConfigError);
  });

  it("refuses a list that is not newest-first, by version and never by value", () => {
    // The failure this closes is silent: better-auth encrypts under the FIRST entry, so
    // `1:<old>,2:<new>` boots, looks rotated, and keeps writing under the old key. The
    // only place that can be caught is boot, because nothing downstream reports which
    // version wrote a blob. Reported by version number like every other refusal (SEC-8).
    const older = synthSecret();
    const newer = synthSecret();
    let message = "";
    try {
      loadConfig(validEnv({ QCMS_ADMIN_AUTH_SECRETS: `1:${older},2:${newer}` }));
    } catch (err) {
      message = (err as ConfigError).message;
    }
    expect(message).toContain("QCMS_ADMIN_AUTH_SECRETS");
    expect(message).toContain("descending version order");
    expect(message).not.toContain(older);
    expect(message).not.toContain(newer);
  });

  it("accepts a descending list with a gap, so a skipped version number is not an error", () => {
    // Versions identify ciphertext, they are not positions: an operator who jumps from 1
    // to 5 has done nothing wrong, and the ordering check must not turn that into a
    // boot failure.
    const newest = synthSecret();
    const oldest = synthSecret();
    const config = loadConfig(validEnv({ QCMS_ADMIN_AUTH_SECRETS: `5:${newest},1:${oldest}` }));
    expect(config.adminAuth.secrets).toEqual([
      { version: 5, value: newest },
      { version: 1, value: oldest },
    ]);
  });

  it("refuses a version that is not a non-negative integer", () => {
    expect(() => loadConfig(validEnv({ QCMS_ADMIN_AUTH_SECRETS: `-1:${synthSecret()}` }))).toThrow(
      ConfigError,
    );
  });

  it("holds every entry to the same length floor as the single-secret form", () => {
    expect(() =>
      loadConfig(validEnv({ QCMS_ADMIN_AUTH_SECRETS: `1:${"s".repeat(MIN_SECRET_LENGTH - 1)}` })),
    ).toThrow(ConfigError);
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
    // Names the canonical spelling only (issue #331): offering both would re-teach the
    // ambiguity that made an operator set two variables for one key.
    expect(message).toContain("QCMS_TURNSTILE_SITE_KEY");
    expect(message).toContain("TURNSTILE_SECRET_KEY");
  });

  it("turnstile with both secrets present parses the challenge config", () => {
    const config = loadConfig(
      validEnv({
        QCMS_FLAG_CHALLENGE_PROVIDER: "turnstile",
        QCMS_TURNSTILE_SITE_KEY: "site-key",
        TURNSTILE_SECRET_KEY: "secret-key",
      }),
    );
    expect(config.flags.challengeProvider).toBe("turnstile");
    expect(config.challenge).toEqual({
      provider: "turnstile",
      turnstile: { siteKey: "site-key", secretKey: "secret-key" },
    });
  });

  /**
   * The site key's two spellings (issue #331). The portal read
   * `QCMS_TURNSTILE_SITE_KEY` and this process read `TURNSTILE_SITE_KEY`, so an operator
   * had to set both for one key and setting only one produced a deployment that boots and
   * silently runs with half the challenge off. The prefixed name is now canonical and the
   * bare one is a fallback with a boot warning.
   */
  describe("the deprecated TURNSTILE_SITE_KEY spelling", () => {
    const turnstile = (overrides: Record<string, string>) =>
      validEnv({
        QCMS_FLAG_CHALLENGE_PROVIDER: "turnstile",
        TURNSTILE_SECRET_KEY: "secret-key",
        ...overrides,
      });

    it("still configures the challenge, so an existing deployment keeps working", () => {
      const config = loadConfig(turnstile({ TURNSTILE_SITE_KEY: "old-key" }));
      expect(config.challenge).toEqual({
        provider: "turnstile",
        turnstile: { siteKey: "old-key", secretKey: "secret-key" },
      });
    });

    it("loses to the canonical name when both are set", () => {
      // Every working deployment today has both, because it had to. The canonical one has
      // to win, or the migration would be "set the new name and nothing changes".
      const config = loadConfig(
        turnstile({ TURNSTILE_SITE_KEY: "old-key", QCMS_TURNSTILE_SITE_KEY: "new-key" }),
      );
      expect(config.challenge).toEqual({
        provider: "turnstile",
        turnstile: { siteKey: "new-key", secretKey: "secret-key" },
      });
    });

    it("is ignored when blank, so an emptied line does not read as configured", () => {
      let message = "";
      try {
        loadConfig(turnstile({ TURNSTILE_SITE_KEY: "   ", QCMS_TURNSTILE_SITE_KEY: "" }));
      } catch (err) {
        message = (err as ConfigError).message;
      }
      expect(message).toContain("QCMS_TURNSTILE_SITE_KEY is required");
    });

    it("warns at boot, naming the deprecation and never the value (SEC-8)", () => {
      const warning = turnstileSiteKeyDeprecationWarning({ TURNSTILE_SITE_KEY: "old-key" });
      expect(warning).toBeDefined();
      expect(warning).toContain("TURNSTILE_SITE_KEY is deprecated");
      expect(warning).toContain("QCMS_TURNSTILE_SITE_KEY");
      expect(warning).not.toContain("old-key");
    });

    it("says which value is in force when both are set and they disagree", () => {
      const agreeing = turnstileSiteKeyDeprecationWarning({
        TURNSTILE_SITE_KEY: "same",
        QCMS_TURNSTILE_SITE_KEY: "same",
      });
      const disagreeing = turnstileSiteKeyDeprecationWarning({
        TURNSTILE_SITE_KEY: "old",
        QCMS_TURNSTILE_SITE_KEY: "new",
      });
      expect(agreeing).toContain("same value");
      expect(disagreeing).toContain("DIFFERENT value");
    });

    it("says nothing when the deprecated spelling is absent or blank", () => {
      expect(turnstileSiteKeyDeprecationWarning({})).toBeUndefined();
      expect(turnstileSiteKeyDeprecationWarning({ TURNSTILE_SITE_KEY: "  " })).toBeUndefined();
      expect(
        turnstileSiteKeyDeprecationWarning({ QCMS_TURNSTILE_SITE_KEY: "new-key" }),
      ).toBeUndefined();
    });
  });

  // ADR-24 as amended (issue #725): the admin surface is told whether a
  // challenge can be verified, never which provider is configured. The
  // derivation lives beside the flag so exactly one place knows that `none`
  // means "the null verifier passes everything".
  it("derives challengeEnforceable from the provider, without exposing it", () => {
    expect(challengeEnforceable(loadConfig(validEnv()).flags)).toBe(false);
    expect(
      challengeEnforceable(
        loadConfig(
          validEnv({
            QCMS_FLAG_CHALLENGE_PROVIDER: "turnstile",
            QCMS_TURNSTILE_SITE_KEY: "site-key",
            TURNSTILE_SECRET_KEY: "secret-key",
          }),
        ).flags,
      ),
    ).toBe(true);
  });

  it("QCMS_ADMIN_2FA folds into the registry (not QCMS_FLAG_ prefixed)", () => {
    expect(loadConfig(validEnv({ QCMS_ADMIN_2FA: "optional" })).flags.adminTwoFactor).toBe(
      "optional",
    );
    expect(() => loadConfig(validEnv({ QCMS_ADMIN_2FA: "sometimes" }))).toThrow(ConfigError);
  });
});

/**
 * The response-snippet retention window (issue #304). Worth pinning rather than
 * leaving to the shared `parseInt_` because this knob's floor is deliberately
 * different from every other duration's: `0` is a **supported policy** here, not a
 * degenerate value, so the usual "must be at least 1000ms" floor would have been
 * wrong. A future tidy-up that made all the duration floors uniform would silently
 * remove an operator's strictest setting; this is what fails if it does.
 */
describe("QCMS_DELIVERY_SNIPPET_TTL_MS (issue #304)", () => {
  it("defaults to the 7 days @qcms/db documents", () => {
    expect(loadConfig(validEnv()).ttl.deliveryResponseSnippetMs).toBe(
      DEFAULT_RESPONSE_SNIPPET_RETENTION_MS,
    );
    expect(DEFAULT_RESPONSE_SNIPPET_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("accepts an explicit window", () => {
    const config = loadConfig(validEnv({ QCMS_DELIVERY_SNIPPET_TTL_MS: "3600000" }));
    expect(config.ttl.deliveryResponseSnippetMs).toBe(3_600_000);
  });

  it("accepts 0 - remove it at the next sweep, the strict-minimisation setting", () => {
    expect(
      loadConfig(validEnv({ QCMS_DELIVERY_SNIPPET_TTL_MS: "0" })).ttl.deliveryResponseSnippetMs,
    ).toBe(0);
  });

  it("refuses a negative window, which would push the horizon into the future", () => {
    // A negative value makes `now - ttl` later than now, so the sweep would redact
    // snippets from attempts that have not happened yet - i.e. all of them, at once.
    expect(() => loadConfig(validEnv({ QCMS_DELIVERY_SNIPPET_TTL_MS: "-1" }))).toThrow(ConfigError);
  });

  it("refuses a non-numeric window rather than falling back to the default", () => {
    expect(() => loadConfig(validEnv({ QCMS_DELIVERY_SNIPPET_TTL_MS: "7d" }))).toThrow(ConfigError);
  });
});

describe("QCMS_ADMIN_PASSWORD_BREACH_CHECK (SEC-1, issue #178)", () => {
  /**
   * The default is asserted from an environment with the variable *deleted*, not from
   * `validEnv()`: that helper deliberately sets it false so the rest of the suite does
   * not depend on api.pwnedpasswords.com, and asserting the default through it would
   * read the helper's opinion back to itself.
   */
  it("defaults to ON when the variable is absent", () => {
    const env = validEnv();
    delete env.QCMS_ADMIN_PASSWORD_BREACH_CHECK;
    expect(loadConfig(env).adminAuth.breachedPasswordCheck).toBe(true);
  });

  it("is honoured when set false, which is the offline-deployment knob", () => {
    const config = loadConfig(validEnv({ QCMS_ADMIN_PASSWORD_BREACH_CHECK: "false" }));
    expect(config.adminAuth.breachedPasswordCheck).toBe(false);
  });

  it("stays on when set true explicitly", () => {
    const config = loadConfig(validEnv({ QCMS_ADMIN_PASSWORD_BREACH_CHECK: "true" }));
    expect(config.adminAuth.breachedPasswordCheck).toBe(true);
  });

  it("refuses an uninterpretable value rather than guessing at it", () => {
    // Boot fails naming the variable. A control the standards write as SHALL must not
    // be turned off by a value the parser could not read. (`off`, `no` and `0` are
    // spellings of false that `parseBool` accepts everywhere, so they are deliberate,
    // not typos.)
    expect(() => loadConfig(validEnv({ QCMS_ADMIN_PASSWORD_BREACH_CHECK: "maybe" }))).toThrow(
      ConfigError,
    );
  });
});

describe("QCMS_ADMIN_SIGNIN_THROTTLE (SEC-1, issue #390)", () => {
  /**
   * The default is the whole ruling on #390: an operator who configures nothing gets
   * the control. Everything else in this block exists to stop that default from being
   * reachable by any route other than the variable itself.
   *
   * Asserted from an environment with the variable *deleted*, never from `validEnv()`:
   * that helper sets it false so an unrelated suite driving four sign-ins does not read
   * a 429 as its own failure, and asserting the default through it would read the
   * helper's opinion back to itself.
   */
  it("defaults to ON when the variable is absent", () => {
    const env = validEnv();
    delete env.QCMS_ADMIN_SIGNIN_THROTTLE;
    expect(loadConfig(env).adminAuth.signInThrottle).toBe(true);
  });

  /**
   * The finding itself, at the configuration layer: before #390 the state of this
   * control was `NODE_ENV === "production"`, resolved inside better-auth. Neither value
   * may move it now, in either direction, or the defect is still here wearing a new
   * name. The behavioural half of this - a real 429 from a real limiter under
   * `NODE_ENV=development` - is `features/auth/sign-in-throttle-state.test.ts`.
   */
  it("is not moved by NODE_ENV, which is the defect this variable exists to remove", () => {
    for (const nodeEnv of ["development", "production", "test", ""]) {
      const env = validEnv({ NODE_ENV: nodeEnv });
      delete env.QCMS_ADMIN_SIGNIN_THROTTLE;
      expect(loadConfig(env).adminAuth.signInThrottle).toBe(true);
    }
  });

  it("is honoured when set false, which is the development escape hatch", () => {
    const config = loadConfig(validEnv({ QCMS_ADMIN_SIGNIN_THROTTLE: "false" }));
    expect(config.adminAuth.signInThrottle).toBe(false);
  });

  it("stays on when set true explicitly", () => {
    const config = loadConfig(validEnv({ QCMS_ADMIN_SIGNIN_THROTTLE: "true" }));
    expect(config.adminAuth.signInThrottle).toBe(true);
  });

  it("refuses an uninterpretable value rather than guessing at it", () => {
    // Boot fails naming the variable. A typo must not be a silent way to serve an
    // unlimited sign-in surface. (`off`, `no` and `0` are spellings of false that
    // `parseBool` accepts everywhere, so they are deliberate, not typos.)
    expect(() => loadConfig(validEnv({ QCMS_ADMIN_SIGNIN_THROTTLE: "maybe" }))).toThrow(
      ConfigError,
    );
  });
});
