import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adminBaseUrl,
  assertNoPlaceholderSecrets,
  assertSecureCookiesConfigured,
  looksLikePlaceholder,
  secureCookies,
} from "./config.ts";

/**
 * The admin's cookie-security configuration (task 056, guarded for issue #292).
 *
 * `vi.stubEnv` rather than assignment: `NODE_ENV` is typed read-only by Next's ambient
 * types, and stubbing restores every variable in one call whichever way a case ends.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * The trailing-slash normalization admin authentication depends on (issue #328).
 *
 * **Paired with `apps/api/src/config.test.ts`.** The API parses the same variable into
 * better-auth's `baseURL` and `trustedOrigins`, and better-auth compares a trusted origin
 * by exact string equality against `new URL(url).origin`, which never carries a trailing
 * slash. This app compares the same value against the `Origin` header on every
 * state-changing POST (SEC-9). So a `QCMS_ADMIN_BASE_URL` with one extra character does
 * not degrade admin authentication, it ends it: sign-in, TOTP verification,
 * recovery-code use and sign-out are all refused, with a CSRF rejection as the only clue.
 *
 * Nothing asserted this on either side until now, which is what the issue is about: the
 * normalizer is one line in each app and a regression in either is invisible.
 */
describe("adminBaseUrl", () => {
  it.each([
    ["https://admin.example.test/", "https://admin.example.test"],
    ["https://admin.example.test///", "https://admin.example.test"],
    ["http://localhost:7040/", "http://localhost:7040"],
  ])("strips the trailing slash from %s", (raw, expected) => {
    vi.stubEnv("QCMS_ADMIN_BASE_URL", raw);
    expect(adminBaseUrl()).toBe(expected);
  });

  it("returns a value equal to its own origin, which is what better-auth compares", () => {
    // The property the consumer depends on, not "a slash was removed": an origin is what
    // `new URL(...).origin` yields, and equality with it is the comparison being relied on.
    for (const raw of ["https://admin.example.test", "https://admin.example.test/"]) {
      vi.stubEnv("QCMS_ADMIN_BASE_URL", raw);
      const base = adminBaseUrl();
      expect(base).toBe(new URL(base).origin);
    }
  });

  it("agrees with the API's normalizer on the shipped Compose value", () => {
    // `.env.compose.example` documents `http://localhost:7040`. Both services read this
    // one variable, and a disagreement between the two normalizers is unobservable until
    // an operator's sign-in POST is rejected.
    vi.stubEnv("QCMS_ADMIN_BASE_URL", "http://localhost:7040/");
    expect(adminBaseUrl()).toBe("http://localhost:7040");
  });

  it("refuses to answer when the variable is absent, rather than inventing an origin", () => {
    vi.stubEnv("QCMS_ADMIN_BASE_URL", undefined);
    expect(() => adminBaseUrl()).toThrow(/QCMS_ADMIN_BASE_URL/);
    vi.stubEnv("QCMS_ADMIN_BASE_URL", "");
    expect(() => adminBaseUrl()).toThrow(/QCMS_ADMIN_BASE_URL/);
  });
});

describe("secureCookies", () => {
  it("honours the override whatever NODE_ENV says", () => {
    vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(secureCookies()).toBe(true);

    vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "false");
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(false);
  });

  it("falls back to NODE_ENV when the override is unset or blank", () => {
    vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(secureCookies()).toBe(false);

    vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "  ");
    vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(true);
  });

  it("accepts the API's boolean spellings, so the two processes cannot disagree", () => {
    for (const raw of ["on", "1", "yes", "TRUE"]) {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", raw);
      expect(secureCookies()).toBe(true);
    }
    for (const raw of ["off", "0", "no", "FALSE"]) {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", raw);
      expect(secureCookies()).toBe(false);
    }
  });

  it("refuses a value that is not a boolean at all", () => {
    vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "maybe");
    expect(() => secureCookies()).toThrow(/QCMS_ADMIN_SECURE_COOKIES/);
  });
});

/**
 * The boot-time refusal (issue #292 point 1).
 *
 * **The portal's `config.test.ts` covers the same decision**, because the two apps
 * disagreeing about exactly this is what the issue was filed about. Nothing computes
 * that the two case lists match, though, and they had already drifted when someone
 * looked (issue #412): a case added here and not there goes unnoticed, so adding one
 * means opening the other file, not trusting a gate.
 *
 * The positive controls come first on purpose: a red then distinguishes "the refusal
 * broke" from "the fixture was never a configuration that boots".
 */
describe("assertSecureCookiesConfigured", () => {
  describe("permits the configurations it exists to allow", () => {
    it("passes the shape .env.compose.example ships: override unset, browsed at http://localhost", () => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", undefined);
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "http://localhost:7040");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes a plain dev server: no override, NODE_ENV development, loopback origin", () => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", undefined);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "http://localhost:7040");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it.each([
      "http://127.0.0.1:7040",
      "http://127.0.0.53:7040",
      "http://[::1]:7040",
      "http://admin.localhost:7040",
      "https://localhost:7040",
    ])("passes the loopback origin %s", (base) => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "false");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", base);
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes any origin at all once Secure is on", () => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "true");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "https://admin.example.test");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });

    it("passes when the base URL is absent or unparseable, which is a different defect", () => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "false");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", undefined);
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "admin.example.test");
      expect(() => assertSecureCookiesConfigured()).not.toThrow();
    });
  });

  describe("refuses the downgrade off loopback", () => {
    it.each([
      "https://admin.example.test",
      "http://admin.example.test",
      "http://192.168.1.10:7040",
      "http://0.0.0.0:7040",
      // A name that merely CONTAINS localhost is not loopback, and an attacker-chosen
      // hostname is exactly where a sloppy substring check would let the downgrade out.
      "http://localhost.admin.example.test",
    ])("refuses %s when the override is false", (base) => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "false");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", base);
      expect(() => assertSecureCookiesConfigured()).toThrow(/Refusing to start/);
    });

    it("refuses every false spelling, not only the literal `false`", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "https://admin.example.test");
      for (const raw of ["false", "0", "no", "off"]) {
        vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", raw);
        expect(() => assertSecureCookiesConfigured()).toThrow(/Refusing to start/);
      }
    });

    it("refuses when the downgrade came from NODE_ENV rather than the override", () => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", undefined);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "https://admin.example.test");
      expect(() => assertSecureCookiesConfigured()).toThrow(/NODE_ENV is not "production"/);
    });

    it("names the variable, the observed condition and the remedy", () => {
      vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "false");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("QCMS_ADMIN_BASE_URL", "https://admin.example.test");

      let message = "";
      try {
        assertSecureCookiesConfigured();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      // The variable that has to change, and the one that was read to decide.
      expect(message).toContain("QCMS_ADMIN_SECURE_COOKIES");
      expect(message).toContain("QCMS_ADMIN_BASE_URL");
      // What was observed, in both halves.
      expect(message).toContain('QCMS_ADMIN_SECURE_COOKIES is set to "false"');
      expect(message).toContain('"https://admin.example.test"');
      expect(message).toContain('host "admin.example.test" is not loopback');
      // The remedy, actionable without reading the source, including the part an
      // operator gets wrong on this origin: the API service reads the same variable.
      expect(message).toContain("QCMS_ADMIN_SECURE_COOKIES=true");
      expect(message).toContain("HTTPS");
      expect(message).toContain("http://localhost");
      expect(message).toContain("api");
      // SEC-8: no credential is echoed. The only values quoted are this flag and the
      // public origin, so nothing secret can reach a log through this path.
      expect(message).not.toMatch(/token|secret|password|key/i);
    });
  });
});

/**
 * The placeholder boot refusal (issue #491, SEC-8).
 *
 * The fixture is the **literal** value from the committed example files rather than an
 * invented string, so this goes red the moment the guard stops covering what an operator
 * would actually copy. The API's equivalent (`apps/api/src/config-placeholders.test.ts`)
 * makes the same choice for the same reason.
 *
 * Agreement between this app's vocabulary, the admin's and the API's is not asserted
 * here: it cannot be, because a cross-app assertion inside one app's Vitest project is
 * cached against that project's own inputs and would report green having never read the
 * file that broke it (`scripts/check-origin-guards.test.ts` records that lesson at
 * length). It is asserted from the repo root, in
 * `scripts/check-bff-config-guards.test.ts`.
 */
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
