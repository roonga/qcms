import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appLocale,
  assertLocaleConfigured,
  parseLocale,
  assertNoPlaceholderSecrets,
  assertSecureCookiesConfigured,
  looksLikePlaceholder,
  portalBaseUrl,
  secureCookies,
} from "./config.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("portalBaseUrl", () => {
  it("returns the configured origin unchanged", () => {
    vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
    expect(portalBaseUrl()).toBe("https://forms.example.test");
  });

  it("trims trailing slashes so a path can always be appended", () => {
    vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test///");
    expect(portalBaseUrl()).toBe("https://forms.example.test");
  });

  it("throws a message naming the variable when it is unset or empty", () => {
    vi.stubEnv("QCMS_PORTAL_BASE_URL", undefined);
    expect(() => portalBaseUrl()).toThrow(/QCMS_PORTAL_BASE_URL/);
    vi.stubEnv("QCMS_PORTAL_BASE_URL", "");
    expect(() => portalBaseUrl()).toThrow(/QCMS_PORTAL_BASE_URL/);
  });
});

describe("secureCookies", () => {
  it('honours QCMS_SECURE_COOKIES="true" whatever NODE_ENV says', () => {
    vi.stubEnv("QCMS_SECURE_COOKIES", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(secureCookies()).toBe(true);
  });

  it('honours QCMS_SECURE_COOKIES="false" whatever NODE_ENV says', () => {
    vi.stubEnv("QCMS_SECURE_COOKIES", "false");
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(false);
  });

  it("falls back to NODE_ENV when the override is unset or blank", () => {
    vi.stubEnv("QCMS_SECURE_COOKIES", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(secureCookies()).toBe(false);

    vi.stubEnv("QCMS_SECURE_COOKIES", "  ");
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(true);
  });

  it("accepts the API's boolean spellings, so the three processes cannot disagree", () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const raw of ["on", "1", "yes", "TRUE", " true "]) {
      vi.stubEnv("QCMS_SECURE_COOKIES", raw);
      expect(secureCookies()).toBe(true);
    }
    vi.stubEnv("NODE_ENV", "production");
    for (const raw of ["off", "0", "no", "FALSE", " false "]) {
      vi.stubEnv("QCMS_SECURE_COOKIES", raw);
      expect(secureCookies()).toBe(false);
    }
  });

  it("refuses a value that is not a boolean at all, naming the variable", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const raw of ["maybe", "banana", "2"]) {
      vi.stubEnv("QCMS_SECURE_COOKIES", raw);
      expect(() => secureCookies()).toThrow(/QCMS_SECURE_COOKIES/);
    }
  });
});

describe("assertSecureCookiesConfigured", () => {
  describe("permits the configurations it exists to allow", () => {
    it("passes the shape .env.compose.example ships: downgrade on, browsed at http://localhost", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "http://localhost:7000");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes a plain dev server: no override, NODE_ENV development, loopback origin", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", undefined);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "http://localhost:7000");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it.each([
      "http://127.0.0.1:7000",
      "http://127.0.0.53:7000",
      "http://[::1]:7000",
      "http://portal.localhost:7000",
      "https://localhost:7000",
    ])("passes the loopback origin %s", (base) => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", base);
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes any origin at all once Secure is on", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "true");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes when the base URL is absent or unparseable, which is a different defect", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", undefined);
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "forms.example.test");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });
  });

  describe("refuses the downgrade off loopback", () => {
    it.each([
      "https://forms.example.test",
      "http://forms.example.test",
      "http://192.168.1.10:7000",
      "http://0.0.0.0:7000",
      "http://localhost.forms.example.test",
    ])("refuses %s when the override is false", (base) => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", base);
      expect(() => assertSecureCookiesConfigured()).toThrow(/Refusing to start/);
    });

    it("refuses when the downgrade came from NODE_ENV rather than the override", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", undefined);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
      expect(() => assertSecureCookiesConfigured()).toThrow(/NODE_ENV is not "production"/);
    });

    it("refuses every false spelling, not only the literal `false`", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
      for (const raw of ["false", "0", "no", "off"]) {
        vi.stubEnv("QCMS_SECURE_COOKIES", raw);
        expect(() => assertSecureCookiesConfigured()).toThrow(/Refusing to start/);
      }
    });

    it.each(["off", "0", "no"])(
      "reports %o as the value it read rather than calling the variable unset",
      (raw) => {
        vi.stubEnv("QCMS_SECURE_COOKIES", raw);
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");

        let message = "";
        try {
          assertSecureCookiesConfigured();
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }

        expect(message).toContain(`QCMS_SECURE_COOKIES is set to "${raw}"`);
        expect(message).not.toContain("is unset");
      },
    );

    it.each(["TRUE", " true", "  false  "])(
      "no longer reaches this guard with %o, because the reader decided it (issue #401)",
      (raw) => {
        vi.stubEnv("QCMS_SECURE_COOKIES", raw);
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");

        if (raw.trim().toLowerCase() === "false") {
          expect(() => assertSecureCookiesConfigured()).toThrow(
            /QCMS_SECURE_COOKIES is set to "false"/,
          );
        } else {
          expect(() => assertSecureCookiesConfigured()).not.toThrow();
        }
      },
    );

    it("lets an unparseable value fail at the reader rather than reaching the guard", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "banana");
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
      expect(() => assertSecureCookiesConfigured()).toThrow(
        /QCMS_SECURE_COOKIES must be a boolean/,
      );
    });

    it.each([undefined, ""])("still reports %o as unset, which it is", (raw) => {
      vi.stubEnv("QCMS_SECURE_COOKIES", raw);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
      expect(() => assertSecureCookiesConfigured()).toThrow(
        /QCMS_SECURE_COOKIES is unset and NODE_ENV is not "production"/,
      );
    });

    it("names the variable, the observed condition and the remedy", () => {
      vi.stubEnv("QCMS_SECURE_COOKIES", "false");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");

      let message = "";
      try {
        assertSecureCookiesConfigured();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain("QCMS_SECURE_COOKIES");
      expect(message).toContain("QCMS_PORTAL_BASE_URL");
      expect(message).toContain('QCMS_SECURE_COOKIES is set to "false"');
      expect(message).toContain('"https://forms.example.test"');
      expect(message).toContain('host "forms.example.test" is not loopback');
      expect(message).toContain("QCMS_SECURE_COOKIES=true");
      expect(message).toContain("HTTPS");
      expect(message).toContain("http://localhost");
      expect(message).not.toMatch(/token|secret|password|key/i);
    });
  });
});

describe("assertNoPlaceholderSecrets", () => {
  /** Verbatim from the committed example files. */
  const SHIPPED = "replace-with-a-random-32-character-internal-token";

  it("passes a real-looking token", () => {
    vi.stubEnv("QCMS_INTERNAL_TOKEN", "8f2c1a9e4b7d6053a1c8e2f4b6d809173a5c7e1b9d0f2468");
    expect(() => assertNoPlaceholderSecrets()).not.toThrow();
  });

  it("passes an unset or empty value, which is a different defect with its own error", () => {
    vi.stubEnv("QCMS_INTERNAL_TOKEN", undefined);
    expect(() => assertNoPlaceholderSecrets()).not.toThrow();
    vi.stubEnv("QCMS_INTERNAL_TOKEN", "");
    expect(() => assertNoPlaceholderSecrets()).not.toThrow();
  });

  it("the shipped placeholder is long enough to pass a length floor, which is why this exists", () => {
    expect(SHIPPED.length).toBeGreaterThanOrEqual(32);
  });

  it("refuses the shipped placeholder and names the variable", () => {
    vi.stubEnv("QCMS_INTERNAL_TOKEN", SHIPPED);
    expect(() => assertNoPlaceholderSecrets()).toThrow(/QCMS_INTERNAL_TOKEN/);
    expect(() => assertNoPlaceholderSecrets()).toThrow(/Refusing to start/);
  });

  it.each([
    "replace_with_a_random_32_character_internal_token",
    "REPLACE-WITH-A-RANDOM-32-CHARACTER-INTERNAL-TOKEN",
    "  replace-with-a-random-32-character-internal-token  ",
    "change-me-change-me-change-me-change-me",
    "changeme-changeme-changeme-changeme-abc",
    "your-internal-token-goes-right-here-ok",
    "example-value-not-for-production-use-x",
    "placeholder-value-not-for-production-x",
    "<generate a 32 character secret here>",
    "replace-before-you-deploy-a-real-key",
  ])("refuses the other spellings an example file might carry: %s", (value) => {
    vi.stubEnv("QCMS_INTERNAL_TOKEN", value);
    expect(() => assertNoPlaceholderSecrets()).toThrow(/QCMS_INTERNAL_TOKEN/);
  });

  it("refuses a placeholder hiding among real entries in a rotation list", () => {
    vi.stubEnv("QCMS_INTERNAL_TOKEN", `8f2c1a9e4b7d6053a1c8e2f4b6d80917,${SHIPPED}`);
    expect(() => assertNoPlaceholderSecrets()).toThrow(/QCMS_INTERNAL_TOKEN/);
  });

  it("never echoes the refused value, only the variable name (SEC-8)", () => {
    vi.stubEnv("QCMS_INTERNAL_TOKEN", SHIPPED);
    let message = "";
    try {
      assertNoPlaceholderSecrets();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("QCMS_INTERNAL_TOKEN");
    expect(message).not.toContain(SHIPPED);
  });

  it("looksLikePlaceholder does not treat real material as a placeholder", () => {
    for (const value of [
      "8f2c1a9e4b7d6053a1c8e2f4b6d809173a5c7e1b9d0f2468ace13579bdf02468",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "correct-horse-battery-staple-and-then-some-more",
    ]) {
      expect(looksLikePlaceholder(value)).toBe(false);
    }
  });
});

describe("QCMS_LOCALE", () => {
  it("defaults to en-GB when unset or blank", () => {
    vi.stubEnv("QCMS_LOCALE", "");
    expect(appLocale()).toBe("en-GB");
    vi.stubEnv("QCMS_LOCALE", "   ");
    expect(appLocale()).toBe("en-GB");
    expect(parseLocale(undefined)).toBe("en-GB");
  });

  it("accepts and canonicalises a supported BCP 47 tag", () => {
    vi.stubEnv("QCMS_LOCALE", "en-US");
    expect(appLocale()).toBe("en-US");
    expect(parseLocale(" de-de ")).toBe("de-DE");
    expect(parseLocale("en-au")).toBe("en-AU");
  });

  it("refuses a malformed or unsupported tag, and never echoes the value", () => {
    for (const bad of ["en_GB_nonsense!", "not a locale", "zz-ZZ-x-not"]) {
      expect(() => parseLocale(bad)).toThrow(/QCMS_LOCALE/u);
      try {
        parseLocale(bad);
      } catch (error) {
        expect(String(error)).not.toContain(bad);
      }
    }
  });

  it("is a boot refusal naming the variable and not the value", () => {
    vi.stubEnv("QCMS_LOCALE", "secret-looking value!");
    expect(() => assertLocaleConfigured()).toThrow(/Refusing to start: QCMS_LOCALE/u);
    try {
      assertLocaleConfigured();
    } catch (error) {
      expect(String(error)).not.toContain("secret-looking value!");
    }
    vi.stubEnv("QCMS_LOCALE", "en-GB");
    expect(() => assertLocaleConfigured()).not.toThrow();
  });
});
